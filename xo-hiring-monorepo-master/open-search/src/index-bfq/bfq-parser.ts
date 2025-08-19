import { parse } from 'jsonc-parser';
import _ from 'lodash';
import { TimeUtils } from '../common/time-utils';
import { S3Utils } from '../common/s3-utils';

/**
 * Interface for BFQ parsers.
 */
export interface IBfqParser {
  parse(data: Buffer): object | undefined;
}

/**
 * Factory for creating BFQ parsers based on the object key.
 * Currently, supports two types of schemas: 'standard-bfq' and 'standard-bfq-job-role'.
 */
export class BfqParserFactory {
  constructor(private readonly s3: S3Utils) {}

  async createParser(objectKey: string): Promise<IBfqParser | null> {
    if (objectKey.startsWith('answers/')) {
      const schemaS3Resource = await this.s3.downloadS3File('config/bfq-questions.jsonc');
      if (!schemaS3Resource) {
        console.warn(`Didn't manage to download BFQ questions schema; skip further processing`);
        return null;
      }
      return new BfqParser(schemaS3Resource.data);
    } else if (objectKey.startsWith('answers-job-role/')) {
      return new NoopBfqParser();
    }

    console.warn(`Unknown schema type for key: ${objectKey}`);
    return null;
  }
}

/**
 * Schemaless BFQ answers parser, which does not perform any parsing.
 */
export class NoopBfqParser implements IBfqParser {
  parse(data: Buffer): object | undefined {
    const jsoncString = data.toString('utf8');

    try {
      return parse(jsoncString);
    } catch (err) {
      console.error(`Failed to parse BFQ json: ${jsoncString}`, err);
    }

    return;
  }
}

/**
 * For number answers, store the bucket the number maps to as a level
 *     Take value number value filled in by the candidate
 *     Get the answerLevels defined for the question in the BFQ configuration
 *     If the question has no answerLevels defined, get the default answerLevels (see root of question configuration)
 *     Identity the level/bucket that fits the number value provided by the candidate based on the min/max values defined for the level
 *         Account for the fact that min and max are optional
 *         Value should be checked as min <= value and value < max
 * For choice answers, store the index of the choice
 * When translating buckets/choices to levels, use a 1-based  reference system (not 0-based) in order to make the querying simpler (eg. skill.level > 0)
 */
export class BfqParser implements IBfqParser {
  private readonly schema: BfqQuestionsSchema | undefined;

  constructor(schema: Buffer) {
    this.schema = this.parseSchema(schema);
  }

  parse(data: Buffer): object | undefined {
    if (!this.schema) {
      console.log('Skip parsing BFQ answers as long as the questions schema is not defined');
      return;
    }

    const jsoncString = data.toString('utf8');
    try {
      const bfqAnswersInput = parse(jsoncString) as BfqAnswersInput;
      console.log('Successfully parsed BFQ answers document');

      const { answers, workingHours } = bfqAnswersInput;
      return _.assign({}, _.omit(bfqAnswersInput, ['lastUpdate', 'answers']), {
        workingHours: {
          utcStart: TimeUtils.convertTimezoneHourToUTCNoDST(workingHours.start, workingHours.timezone),
          utcEnd: TimeUtils.convertTimezoneHourToUTCNoDST(workingHours.end, workingHours.timezone),
          flexible: workingHours.flexible,
        },
        bfqAnswers: this.parseAnswers(answers),
        bfqKeywords: this.parseKeywords(answers),
      });
    } catch (err) {
      console.error(`Failed to parse BFQ json: ${jsoncString}`, err);
    }
    return;
  }

  parseAnswers(answers: BfqAnswer[]): object {
    const response = {};
    answers.forEach((answer) => {
      const questionSchema = this.getQuestionSchema(answer);
      if (!questionSchema) {
        console.warn(`Unknown question id provided: ${answer.questionId}`);
        return;
      }
      switch (questionSchema.answerType) {
        case 'choice':
          this.setNumericValue(answer, response, answer.value);
          break;
        case 'number':
          this.calcNumberAnswerType(questionSchema, answer, response);
          break;
        default:
          console.warn(`Unknown answer type provided: ${questionSchema.answerType}`);
          break;
      }
    });
    return response;
  }

  private calcNumberAnswerType(questionSchema: BfqQuestionSchema, answer: BfqAnswer, response: object) {
    const { questionType } = questionSchema;
    switch (questionType) {
      case 'simple':
        {
          const value = this.calculateAnswerLevel(questionSchema, answer.value);
          this.setNumericValue(answer, response, value);
        }
        break;
      case 'multifaceted':
        this.calculateMultifacetedAnswerLevels(questionSchema, answer, response);
        break;
      default:
        console.warn(`Unknown question type provided: ${questionType}`);
    }
  }

  private calculateMultifacetedAnswerLevels(questionSchema: BfqQuestionSchema, answer: BfqAnswer, response: object) {
    const { facets } = answer;
    if (!facets) {
      console.warn('Facets are not defined for multifaceted answer');
      return;
    }
    _.set(
      response,
      `${answer.questionId}`,
      facets.map((facet) => {
        const level = this.calculateAnswerLevel(questionSchema, facet.value);
        const facetValue = { level };
        if (facet.notes) {
          _.set(facetValue, 'notes', facet.notes);
        }
        return {
          [facet.facet]: facetValue,
        };
      }),
    );
  }

  private calculateAnswerLevel(questionSchema: BfqQuestionSchema, value: number): number {
    const answerLevels = questionSchema.answerLevels ?? this.schema?.defaults.answerLevels ?? [];
    let level = 1;
    for (const answerLevel of answerLevels) {
      const min = answerLevel.min ?? 0;
      const max = answerLevel.max ?? Number.MAX_SAFE_INTEGER;

      if (value >= min && value < max) {
        // in the bucket
        break;
      }
      level++;
    }
    return level;
  }

  private setNumericValue(answer: BfqAnswer, response: object, value: number | undefined) {
    const answerValue = { level: value };
    if (answer.notes) {
      _.set(answerValue, 'notes', answer.notes);
    }
    _.set(response, `${answer.questionId}`, answerValue);
  }

  private getQuestionSchema(answer: BfqAnswer): BfqQuestionSchema | undefined {
    return this.schema?.questions.filter((q) => q.id === answer.questionId).pop();
  }

  parseKeywords(answers: BfqAnswer[]): string {
    const facetsMap = new Map<string, string>();
    this.schema?.questions.forEach((question) => {
      question.facets?.forEach((facet) => {
        facetsMap.set(facet.code, facet.label);
      });
    });
    return _.uniq(
      answers
        .filter((a) => a.facets)
        .map((a) => a.facets?.map((f) => facetsMap.get(f.facet)).filter((f) => f))
        .flat(),
    ).join(' ');
  }

  private parseSchema(schema: Buffer): BfqQuestionsSchema | undefined {
    const jsoncString = schema.toString('utf8');
    try {
      return parse(jsoncString) as BfqQuestionsSchema;
    } catch (err) {
      console.error(`Failed to parse BFQ questions schema json: ${jsoncString}`, err);
    }
    return;
  }
}

type AnswerLevel = {
  label: string;
  min: number | undefined;
  max: number | undefined;
};

type BfqQuestionSchema = {
  id: string;
  questionLabel: string;
  questionType: string;
  answerType: string;
  facets:
    | Array<{
        code: string;
        label: string;
      }>
    | undefined;
  answerChoices: string[] | undefined;
  answerLevels: AnswerLevel[] | undefined;
};

type BfqQuestionsSchema = {
  defaults: {
    answerLevels: AnswerLevel[];
  };
  mappings: {
    generalQuestions: string[];
    domainQuestions: Array<{
      domain: string;
      questionsIds: string[];
    }>;
  };
  questions: BfqQuestionSchema[];
};

type BfqAnswer = {
  questionId: string;
  value: number;
  notes: string | undefined;
  facets:
    | Array<{
        facet: string;
        value: number;
        notes: string | undefined;
      }>
    | undefined;
};

type BfqAnswersInput = {
  acceptableCompensation: number;
  desiredCompensation: number;
  workingHours: {
    timezone: string;
    start: number;
    end: number;
    flexible: boolean;
  };
  availabilityToStart: number;
  domains: string[];
  answers: BfqAnswer[];
};

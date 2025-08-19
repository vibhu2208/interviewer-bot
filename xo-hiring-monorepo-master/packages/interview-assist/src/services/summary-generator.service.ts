import { defaultLogger, SalesforceClient } from '@trilogy-group/xoh-integration';
import { generateText } from 'ai';
import Handlebars from 'handlebars';
import { Llm } from '../integrations/llm';
import { OpenSearchClient } from '../integrations/opensearch.client';
import { Config } from '../models/config';
import { Prompt } from '../models/prompt';
import { ReadAiTranscript, ReadAITranscriptSpeakerBlock } from '../models/read-ai-transcript';
import { Summary } from '../models/summary';
import {
  BadgeData,
  CandidateData,
  ComprehensiveInterviewContext,
  InterviewConversation,
  InterviewQuestionAnswer,
  KontentPipelineDescription,
} from '../models/summary-generator.model';
import { AsrDataService } from './asr-data.service';
import { CandidateDataService } from './candidate-data.service';
import { PipelineDataService } from './pipeline-data.service';

const log = defaultLogger({ serviceName: 'summary-generator-service' });

export class SummaryGeneratorService {
  private readonly pipelineService: PipelineDataService;
  private readonly asrService: AsrDataService;
  private readonly candidateService: CandidateDataService;

  constructor(sfClient: SalesforceClient, openSearchClient: OpenSearchClient) {
    this.pipelineService = new PipelineDataService(sfClient);
    this.asrService = new AsrDataService(sfClient);
    this.candidateService = new CandidateDataService(openSearchClient);
  }

  public async generateSummary(
    transcriptId: string,
    forcePromptId: string | null = null,
    save = true,
  ): Promise<string> {
    log.resetKeys();
    log.appendKeys({ transcriptId });
    const config = await Config.fetch();
    if (config == null) {
      throw new Error('Config not found');
    }
    const readAiFullTranscript = await ReadAiTranscript.getById(transcriptId);
    if (readAiFullTranscript == null) {
      throw new Error(`Transcript ${transcriptId} not found`);
    }
    const promptData = await Prompt.getById(forcePromptId ?? config.defaultPromptId);
    if (promptData == null) {
      throw new Error(`Prompt ${forcePromptId ?? config.defaultPromptId} not found`);
    }

    try {
      log.info(`Generating summary for transcript ${transcriptId}`);

      let pipelineDescription: KontentPipelineDescription | null = null;
      let candidateId: string | null = null;
      let applicationIdFromAsr: string | null = null;
      let candidateResumeData: CandidateData | undefined = undefined;
      let candidateBadgesData: BadgeData[] = [];
      let matchingInterviewConversations: InterviewConversation[] = [];
      let regularInterviewConversation: InterviewConversation | null = null;
      let interviewQAList: InterviewQuestionAnswer[] = [];

      const currentInterviewPayload = readAiFullTranscript.payload;

      if (readAiFullTranscript.asrId) {
        log.appendKeys({ asrId: readAiFullTranscript.asrId });
        const asrContext = await this.asrService.getContextualIdsFromAsr(readAiFullTranscript.asrId);
        if (asrContext) {
          candidateId = asrContext.candidateId;
          applicationIdFromAsr = asrContext.applicationId;
          pipelineDescription = await this.pipelineService.getPipelineDescription(asrContext.pipelineId);

          if (candidateId) {
            log.appendKeys({ candidateId });
            candidateResumeData = await this.candidateService.getCandidateResume(candidateId);
            const assessments = await this.asrService.getCandidateAssessments(candidateId, applicationIdFromAsr);
            matchingInterviewConversations = await this.asrService.getAIInterviewConversations(assessments);
            const nonInterviewAssessments = assessments.filter(
              (assessment) => assessment.applicationStage !== 'Interview',
            );
            log.info(
              `Filtered ${assessments.length} assessments down to ${nonInterviewAssessments.length} non-interview assessments for badge processing.`,
            );
            candidateBadgesData = this.asrService.getBadgesFromAssessments(nonInterviewAssessments);

            const interviewStageAssessments = assessments.filter(
              (assessment) => assessment.applicationStage === 'Interview',
            );
            log.info(`Found ${interviewStageAssessments.length} assessments from interview stages for Q&A processing.`);
            interviewQAList = interviewStageAssessments.flatMap(
              (assessment) =>
                assessment.surveyResponses?.map((sr) => ({
                  sourceAssessmentName: assessment.stepDisplayName || assessment.assessmentName,
                  question: sr.question,
                  answer: sr.response,
                })) || [],
            );
          }
        } else {
          log.warn(`Could not get contextual IDs from ASR ${readAiFullTranscript.asrId}.`);
        }
      } else {
        log.warn('No ASR ID available from transcript. Cannot fetch necessary context.');
      }

      if (!pipelineDescription) {
        throw new Error('Failed to fetch pipeline description. Cannot generate quality summary.');
      }

      log.info(`Preparing summary for transcript ${transcriptId} using prompt ${promptData.id}`);
      if (candidateId) log.info(`Context: CandidateId=${candidateId}`);
      if (applicationIdFromAsr) log.info(`Context: ApplicationId=${applicationIdFromAsr}`);
      if (candidateResumeData)
        log.info(
          `Context: Resume data ${candidateResumeData.resume || candidateResumeData.profile ? 'found' : 'not found'}.`,
        );
      else log.info('Context: No resume data.');
      log.info(`Context: ${candidateBadgesData.length} badges found (from non-interview stages).`);
      log.info(`Context: ${matchingInterviewConversations.length} AI matching interview logs found.`);
      log.info(`Context: ${interviewQAList.length} Q&A pairs found from interview stage assessments.`);

      const interviewSourceName = currentInterviewPayload.title;
      const currentInterviewConversation: InterviewConversation = {
        sourceName: interviewSourceName,
        interviewDate: currentInterviewPayload.start_time,
        conversation: currentInterviewPayload.transcript.speaker_blocks.map((block: ReadAITranscriptSpeakerBlock) => {
          let role = 'Unknown';
          const speakerName = block.speaker?.name;
          if (speakerName) {
            const participant = currentInterviewPayload.participants.find((p) => p.name === speakerName);
            if (participant && currentInterviewPayload.owner?.email === participant.email) {
              role = 'Interviewer';
            } else if (participant) {
              role = 'Candidate';
            } else {
              if (currentInterviewPayload.transcript.speakers?.length === 1) role = 'Candidate';
              else if (
                currentInterviewPayload.transcript.speakers?.length > 1 &&
                speakerName === currentInterviewPayload.transcript.speakers[0]?.name
              )
                role = 'Interviewer';
              else if (
                currentInterviewPayload.transcript.speakers?.length > 1 &&
                speakerName === currentInterviewPayload.transcript.speakers[1]?.name
              )
                role = 'Candidate';
            }
          }
          return {
            role: role,
            content: block.words || '',
          };
        }),
      };
      regularInterviewConversation = currentInterviewConversation;

      const promptContext: ComprehensiveInterviewContext = {
        jobDescription: pipelineDescription as KontentPipelineDescription,
        candidateResume: candidateResumeData,
        candidateBadges: candidateBadgesData,
        matchingInterviewLogs: matchingInterviewConversations,
        regularInterviewLog: regularInterviewConversation,
        interviewQA: interviewQAList,
        candidateId: candidateId,
      };

      const userPromptTemplate = Handlebars.compile(promptData.user, { noEscape: true });
      const userPrompt = userPromptTemplate(promptContext);

      log.info(`System prompt: ${promptData.system}`);
      log.info(`User prompt: ${userPrompt}`);

      const model = await Llm.getModel(promptData);
      const { text } = await generateText({
        model: model,
        system: promptData.system,
        prompt: userPrompt,
      });

      log.info(`Response (first 500 chars): ${text.substring(0, 500)}`);

      if (save) {
        log.info(`Saving summary for transcript ${transcriptId} into the DDB`);
        await Summary.insertNew({
          transcriptId: transcriptId,
          reportUrl: currentInterviewPayload.report_url,
          summary: text,
          promptId: promptData.id,
        });
      }
      return text;
    } catch (error) {
      log.error(`Error generating summary for transcript ${transcriptId}: ${(error as Error).message}`);
      throw error;
    }
  }
}

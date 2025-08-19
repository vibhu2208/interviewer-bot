import { Athena } from '@trilogy-group/xoh-integration';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { Config } from '../config';
import { QuestionDocument, SimilarityScore } from '../model/question';
import { SessionDocument } from '../model/session';

const log = Logger.create('performFraudCheck');

/**
 * Normalizes text by converting to lowercase, removing non-alphanumeric characters,
 * and normalizing whitespace.
 * @param text The text to normalize
 * @returns The normalized text
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove non-alphanumeric characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * This is Athena Parametrized query
 * Parameters:
 * 1. Answer we're testing
 * 2. Question pk (QUESTION#<questionId>)
 * 3. Candidate email (to ignore answers from the same candidate)
 */
const SimilarityScoreQuery = `
WITH base_text AS (
	SELECT ? as reference_text
),
cleaned_answers AS (
	SELECT 
    CASE
      WHEN q.defaultAnswer IS NOT NULL THEN 
          REPLACE(
            LOWER(TRIM(REGEXP_REPLACE(
              REGEXP_REPLACE(q.answer, '[^a-zA-Z0-9\\s]', ''),
              '\\s+', ' '
            ))),
            LOWER(TRIM(REGEXP_REPLACE(
              REGEXP_REPLACE(q.defaultAnswer, '[^a-zA-Z0-9\\s]', ''),
              '\\s+', ' '
            )))
          )
      ELSE LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(q.answer, '[^a-zA-Z0-9\\s]', ''),
        '\\s+', ' '
      ))
    END as cleaned_answer,
		q.pk as pk
	FROM interview_bot q
	JOIN interview_bot s ON s.pk = q.pk AND s.sk = 'SESSION'
	WHERE q.gsi1pk = ?
		AND q.gsi1sk LIKE 'SESSION#%'
		AND q.answer IS NOT NULL
		AND length(trim(q.answer)) > 0
		AND s.testTaker.email != ?
    AND q.answer != 'No answer provided'
),
answer_metrics AS (
	SELECT ca.pk,
		ca.cleaned_answer,
		bt.reference_text,
		-- Basic metrics (for Jaccard similarity)
		LENGTH(ca.cleaned_answer) as len1,
		LENGTH(bt.reference_text) as len2,
		-- Word arrays (for Jaccard similarity)
		SPLIT(LOWER(TRIM(ca.cleaned_answer)), ' ') as words1,
		SPLIT(LOWER(TRIM(bt.reference_text)), ' ') as words2
	FROM cleaned_answers ca
		CROSS JOIN base_text bt
),
similarity_calculation AS (
	SELECT pk,
		cleaned_answer,
		reference_text,
        -- Jaccard similarity metrics
		-- Length difference
		ABS(len1 - len2) as length_difference,
		-- Word count difference
		ABS(CARDINALITY(words1) - CARDINALITY(words2)) as word_count_difference,
		-- Common words
		CARDINALITY(ARRAY_INTERSECT(words1, words2)) as common_words,
		-- Total unique words
		CARDINALITY(ARRAY_UNION(words1, words2)) as total_unique_words,
        -- Maximum length for similarity calculation
		GREATEST(len1, len2) as max_len,
		-- Levenshtein distance
		CASE
			WHEN length(cleaned_answer) < (ROUND(1000000 / length(reference_text)) - 1) THEN levenshtein_distance(cleaned_answer, reference_text) ELSE -1
		END as levenshtein_dist
	FROM answer_metrics
),
final_similarity AS (
	SELECT pk,
		cleaned_answer,
		length_difference,
		word_count_difference,
		common_words,
		-- Calculate Jaccard similarity
		CAST(common_words AS DOUBLE) / NULLIF(total_unique_words, 0) as jaccard_similarity,
		-- Levenshtein distance
		levenshtein_dist,
		-- Calculate Levenshtein similarity (1 - distance/max_length)
		CASE
			WHEN levenshtein_dist = -1 THEN 0
			ELSE 1 - (CAST(levenshtein_dist AS DOUBLE) / NULLIF(max_len, 0))
		END as levenshtein_similarity
	FROM similarity_calculation
)
SELECT 
    pk,
    cleaned_answer,
    levenshtein_dist,
    jaccard_similarity,
    levenshtein_similarity
FROM final_similarity
WHERE levenshtein_similarity > 0.9 OR jaccard_similarity > 0.6
ORDER BY levenshtein_similarity DESC, jaccard_similarity DESC
LIMIT 10;
  `.trim();

interface SimilarityRow {
  pk: string;
  jaccard_similarity: string;
  levenshtein_dist: string;
  levenshtein_similarity: string;
}

export async function performFraudCheck(
  session: SessionDocument,
  question: QuestionDocument,
  answer: string,
  logContext?: InterviewBotLoggingContext,
): Promise<void> {
  try {
    log.info(`Performing fraud check for session ${session.id} / questions ${question.id}`, logContext);
    if (answer == null || answer.trim().length === 0) {
      log.info('Answer is null or empty, skipping fraud check', logContext);
      return;
    }

    // Cleanup answer using the shared normalization function
    answer = normalizeText(answer);

    if (question.defaultAnswer != null) {
      // Remove default answer from the answer
      answer = answer.replace(normalizeText(question.defaultAnswer), '');
    }

    const queryParameters: string[] = [
      answer,
      question.gsi1pk as string, // Question pk
      session.testTaker?.email ?? '', // Candidate email, we're keeping it safe just in case
    ];

    log.debug(`Query parameters: ${queryParameters.join(', ')}`, logContext);

    const rows = await Athena.query<SimilarityRow>(SimilarityScoreQuery, {
      parameters: queryParameters,
      database: Config.getAthenaDatabaseName(),
    });

    log.info(`Found ${rows.length} rows while doing fraud-check`, logContext);

    if (rows.length === 0) {
      log.info('No rows found, skipping fraud check', logContext);
      return;
    }

    // Map all rows to similarity scores
    const similarityScores: SimilarityScore[] = rows.map((row) => ({
      id: row.pk.split('#')[1], // Extract session id from the pk
      jaccard: Number(row.jaccard_similarity),
      levenshtein: Number(row.levenshtein_similarity),
    }));

    log.info(`Generated ${similarityScores.length} similarity scores`, logContext);

    // Update the question with all similarity scores
    question.similarityScores = similarityScores;
  } catch (error) {
    log.error(`Error performing fraud check: ${error}`, logContext);
  }
}

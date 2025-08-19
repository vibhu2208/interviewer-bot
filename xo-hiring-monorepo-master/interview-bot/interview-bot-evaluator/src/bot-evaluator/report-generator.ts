import fs from 'fs';
import * as path from 'path';

interface Check {
  name: string;
  status: 'Pass' | 'Fail' | 'N/A';
  reasoning: string;
  evidence: string;
}

interface Evaluation {
  summary: string;
  gradingSummaryEvaluation: string;
  checks: Check[];
}

interface Persona {
  name: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'CONTROL';
}

interface ConversationElement {
  role?: string | null;
  content?: string | null;
}

interface Session {
  questions: {
    conversation: (ConversationElement | null)[];
    correctnessGrading: {
      score: number;
      summary: string;
    };
  }[];
}

interface ReportData {
  persona: Persona;
  evaluation: Evaluation;
  session: Session;
}

const PRIORITY_ORDER = { CONTROL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function normalizeLabel(input: string): string {
  return input.replace(/^\[[^\]]+\]\s*/, '');
}

function logInfo(message: string): void {
  console.log(message);
}

/**
 * Reads JSON file and generates a markdown table of evaluation checks by persona
 * @param data Array of ReportData
 * @returns Markdown table as string
 */
export function generateChecksTable(data: ReportData[]): string {
  try {
    // Sort by priority (HIGH first) then by name
    const sortedData = data.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.persona.priority] - PRIORITY_ORDER[b.persona.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.persona.name.localeCompare(b.persona.name);
    });

    // Get all unique check names
    const allCheckNames = new Set<string>();
    sortedData.forEach((item) => {
      item.evaluation.checks.forEach((check) => allCheckNames.add(normalizeLabel(check.name)));
    });

    const checkNames = Array.from(allCheckNames);

    // Generate markdown table
    let markdown = '';

    // Header row
    markdown += '| Persona |';
    checkNames.forEach((checkName) => {
      markdown += ` ${checkName} |`;
    });
    markdown += '\n';

    // Separator row
    markdown += '|---------|';
    checkNames.forEach(() => {
      markdown += '----------|';
    });
    markdown += '\n';

    // Data rows
    sortedData.forEach((item) => {
      markdown += `| ${item.persona.name} |`;

      // Create a map for quick lookup of check statuses
      const checkMap = new Map<string, string>();
      item.evaluation.checks.forEach((check) => {
        checkMap.set(normalizeLabel(check.name), check.status);
      });

      // Add status for each check
      checkNames.forEach((checkName) => {
        const status = checkMap.get(checkName) || 'N/A';
        markdown += ` ${status} |`;
      });
      markdown += '\n';
    });

    return markdown;
  } catch (error) {
    throw new Error(`Failed to generate checks table: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generates and saves the checks table to a file
 * @param data Array of ReportData
 * @param outputFilePath Path where the markdown table should be saved
 */
export function saveChecksTable(data: ReportData[], outputFilePath: string): void {
  const markdown = generateChecksTable(data);
  fs.writeFileSync(outputFilePath, markdown, 'utf-8');
  logInfo(`Checks table saved to: ${outputFilePath}`);
}

export function getReport(inputFilePath: string): ReportData {
  const fileContent = fs.readFileSync(inputFilePath, 'utf-8');
  const data: ReportData = JSON.parse(fileContent);
  return data;
}

function saveEvaluationSummary(
  data: ReportData[],
  outputPath: string,
): {
  persona: string;
  conversation: (ConversationElement | null)[][];
  evaluation: Evaluation;
}[] {
  const output = data.map((d) => ({
    persona: d.persona.name,
    conversation: d.session.questions.map((q) => q?.conversation || []),
    grading: {
      score: d.session.questions[0]?.correctnessGrading?.score,
      summary: d.session.questions[0]?.correctnessGrading?.summary,
    },
    evaluation: d.evaluation,
  }));
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  logInfo(`Checks table saved to: ${outputPath}`);
  return output;
}

function saveEvaluationSummaryMarkdown(
  data: {
    persona: string;
    conversation: (ConversationElement | null)[][];
    grading: {
      score: number;
      summary: string;
    };
    evaluation: Evaluation;
  }[],
  outputPath: string,
): void {
  const output = data.map((d) => {
    let markdown = `# ${d.persona}\n\n`;
    markdown += `## Evaluation\n\n${d.evaluation.summary}\n\n`;
    markdown += `## Conversation\n\n${d.conversation
      .map((c) => c.map((e) => `**${e?.role?.toUpperCase()}:** ${e?.content}`).join('\n\n'))
      .join('\n')}\n\n`;
    markdown += `## Grading\n\n`;
    markdown += `Score: ${d.grading.score}\n\n`;
    if (d.grading.summary && d.grading.summary !== 'TODO: please ignore.') {
      markdown += `Summary: \n\`\`\`\n${JSON.stringify(JSON.parse(d.grading.summary), null, 2)}\n\`\`\`\n\n`;
    }
    return markdown;
  });
  const markdown = output.join('\n\n');
  fs.writeFileSync(outputPath, markdown, 'utf-8');
  logInfo(`Checks table saved to: ${outputPath}`);
}

// Read all report files in the input path and consolidate them into a single file
function consolidateReports(inputPath: string, combinedPath: string): ReportData[] {
  const files = fs.readdirSync(inputPath);
  const reports = files
    .map((file) => {
      if (file.startsWith('report-')) {
        const data = getReport(path.join(inputPath, file));
        return data;
      }
      return null;
    })
    .filter((r): r is ReportData => r !== null);
  fs.writeFileSync(combinedPath, JSON.stringify(reports, null, 2), 'utf-8');
  return reports;
}

// Example usage if run directly
if (require.main === module) {
  const inputPath = './reports';
  const combinedPath = './reports/combined.json';
  const outputPath = './reports/checks-table.md';
  const evaluationSummaryPath = './reports/evaluation-summary.json';
  const evaluationSummaryMarkdownPath = './reports/evaluation-summary.md';
  try {
    const data = consolidateReports(inputPath, combinedPath);
    saveChecksTable(data, outputPath);
    const summary = saveEvaluationSummary(data, evaluationSummaryPath);
    saveEvaluationSummaryMarkdown(summary, evaluationSummaryMarkdownPath);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

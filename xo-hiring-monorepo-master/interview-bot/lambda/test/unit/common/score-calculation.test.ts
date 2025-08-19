import { ScoreCalculation, SessionGradingContext } from '../../../src/common/score-calculation';
import { QuestionDocument } from '../../../src/model/question';
import { Session, SessionDocument } from '../../../src/model/session';
import { SkillDocument } from '../../../src/model/skill';

describe('score-calculation', () => {
  test('should calculate average between depth and correctness', () => {
    // Arrange
    const questions: QuestionDocument[] = [
      {
        status: 'Published',
        depthGrading: {
          score: 2,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
      {
        status: 'Published',
        depthGrading: {
          score: 8,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
    ];

    // Act
    const score = ScoreCalculation.calculateForQuestions(questions);

    // Assert
    expect(score).toBe(4.5);
  });

  test('should ignore questions without score', () => {
    // Arrange
    const questions: QuestionDocument[] = [
      {
        status: 'Published',
        depthGrading: {
          score: 2,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
      {
        status: 'Published',
        depthGrading: {
          score: 8,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
      {
        status: 'Published',
        depthGrading: {},
        correctnessGrading: {},
      } as QuestionDocument,
    ];

    // Act
    const score = ScoreCalculation.calculateForQuestions(questions);

    // Assert
    expect(score).toBe(4.5);
  });

  test('should ignore depth if not present', () => {
    // Arrange
    const questions: QuestionDocument[] = [
      {
        status: 'Published',
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
      {
        status: 'Published',
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
    ];
    const skill = {
      mode: 'free-response',
    } as SkillDocument;

    // Act
    const score = ScoreCalculation.calculateForQuestions(questions);

    // Assert
    expect(score).toBe(4);
  });

  test('should ignore questions in Calibration', () => {
    // Arrange
    const questions: QuestionDocument[] = [
      {
        status: 'Published',
        depthGrading: {
          score: 2,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
      {
        status: 'Calibration',
        depthGrading: {
          score: 8,
        },
        correctnessGrading: {
          score: 4,
        },
      } as QuestionDocument,
    ];

    // Act
    const score = ScoreCalculation.calculateForQuestions(questions);

    // Assert
    expect(score).toBe(3);
  });

  test('scoreOverrideFromTabSwitch should return a grading with score 0 if tab switches exceed the limit', () => {
    // Arrange
    const session: SessionDocument = {
      id: 'session-1',
      sessionEvents: [{ type: 'tabVisibilityLost' }, { type: 'tabVisibilityLost' }, { type: 'tabVisibilityLost' }],
    } as any;
    const skill: SkillDocument = {
      failIfDetectedTabSwitchesMoreThan: 2,
    } as any;

    // Act
    const result = ScoreCalculation.scoreOverrideFromTabSwitch(session, skill);

    // Assert
    expect(result).toEqual({
      score: 0,
      summary: 'Candidate switched tab 3 times (> 2)',
    });
  });

  test('scoreOverrideFromTabSwitch should return null if tab switches do not exceed the limit', () => {
    // Arrange
    const session: SessionDocument = {
      id: 'session-2',
      sessionEvents: [{ type: 'tabVisibilityLost' }, { type: 'tabVisibilityLost' }],
    } as any;
    const skill: SkillDocument = {
      failIfDetectedTabSwitchesMoreThan: 2,
    } as any;

    // Act
    const result = ScoreCalculation.scoreOverrideFromTabSwitch(session, skill);

    // Assert
    expect(result).toBeNull();
  });

  test('scoreOverrideFromTabSwitch should handle sessions with no tab switch events', () => {
    // Arrange
    const session: SessionDocument = {
      sessionEvents: [],
    } as any;
    const skill: SkillDocument = {
      failIfDetectedTabSwitchesMoreThan: 1,
    } as any;

    // Act
    const result = ScoreCalculation.scoreOverrideFromTabSwitch(session, skill);

    // Assert
    expect(result).toBeNull();
  });

  test('scoreOverrideFromTabSwitch should handle null sessionEvents gracefully', () => {
    // Arrange
    const session: SessionDocument = {
      id: 'session-4',
    } as any;
    const skill: SkillDocument = {
      failIfDetectedTabSwitchesMoreThan: 1,
    } as any;

    // Act
    const result = ScoreCalculation.scoreOverrideFromTabSwitch(session, skill);

    // Assert
    expect(result).toBeNull();
  });

  test('gradeSession should calculate final score and update session state', async () => {
    // Arrange
    Session.setStateToGraded = jest.fn();

    const session: SessionDocument = {
      id: 'session-1',
      sessionEvents: [],
      secretKey: 'TEST',
    } as any;
    const skill: SkillDocument = {} as any;
    const questions: QuestionDocument[] = [
      {
        status: 'Published',
        depthGrading: { score: 3 },
        correctnessGrading: { score: 4 },
      } as QuestionDocument,
    ];
    const context: SessionGradingContext = {
      session,
      skill,
      questions,
    };
    const summary = 'Final grading summary';

    // Act
    await ScoreCalculation.gradeSession(summary, context);

    // Assert
    expect(Session.setStateToGraded as jest.Mock).toHaveBeenCalledWith(
      session.id,
      {
        score: 3.5, // Assuming the average score between depth (3) and correctness (4) is 3.5
        summary,
      },
      false,
    );
  });
});

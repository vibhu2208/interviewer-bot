import { Session, SessionState } from '../../../src/model/session';
import { checkSessionExpiration } from '../../../src/tasks/checkSessionExpiration';
describe('checkSessionExpiration', () => {
  // Session state, Should expire
  const matrix: any[] = [
    ['Initializing', false],
    ['Ready', false],
    ['Started', true],
    ['Completed', false],
    ['Graded', false],
  ];

  test.each(matrix)('Given session state %p, should expire: %p', async (state: SessionState, expired: boolean) => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue({
      id: '1',
      state: state,
    });
    Session.setStateToCompleted = jest.fn();

    // Act
    await checkSessionExpiration({
      type: 'check-session-expiration',
      sessionId: '1',
    });

    // Assert
    expect(Session.setStateToCompleted).toBeCalledTimes(expired ? 1 : 0);
  });
});

import { APIGatewayProxyEvent } from 'aws-lambda';
import { when, verifyAllWhenMocksCalled } from 'jest-when';
import { handler } from '../../../src/handlers/fetchInterviewConversations';
import { fetchInterviewConversations as fetchInterviewConversationsService } from '../../../src/services/interview-conversation.service';
import { InterviewConversation } from '../../../src/model/interview-conversation.models';

// Mocks
jest.mock('../../../src/services/interview-conversation.service');

const mockedFetchInterviewConversationsService = fetchInterviewConversationsService as jest.Mock;

describe('fetchInterviewConversations handler', () => {
  let mockEvent: Partial<APIGatewayProxyEvent>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEvent = {
      httpMethod: 'POST',
      path: '/',
      headers: { 'Content-Type': 'application/json' },
    };
  });

  afterEach(() => {
    verifyAllWhenMocksCalled();
  });

  const mockSessionIds = ['session123'];

  const mockInterviewConversations: InterviewConversation[] = [
    {
      sessionId: 'session123',
      questionId: 'q1',
      conversation: [{ role: 'Candidate', content: 'Hello' }],
    },
  ];

  it('should successfully call the service and return 200', async () => {
    mockEvent.body = JSON.stringify({ sessionIds: mockSessionIds });
    when(mockedFetchInterviewConversationsService)
      .calledWith(mockSessionIds)
      .mockResolvedValueOnce(mockInterviewConversations);

    const result = await handler(mockEvent as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(JSON.stringify({ interviewConversations: mockInterviewConversations }));
  });

  it('should return 400 if request body is not valid JSON', async () => {
    mockEvent.body = 'not-json';
    const result = await handler(mockEvent as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Invalid JSON in request body.');
  });

  it('should return 400 if sessionIds array is missing in request body', async () => {
    mockEvent.body = JSON.stringify({}); // Missing sessionIds key
    const result = await handler(mockEvent as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toBeDefined();
  });

  it('should return 400 if sessionIds is not an array', async () => {
    mockEvent.body = JSON.stringify({ sessionIds: 'not-an-array' });
    const result = await handler(mockEvent as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toBeDefined();
  });

  it('should return 400 if request body is null', async () => {
    mockEvent.body = null;
    const result = await handler(mockEvent as APIGatewayProxyEvent);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toBeDefined();
  });

  it('should return 500 if service throws an error', async () => {
    mockEvent.body = JSON.stringify({ sessionIds: mockSessionIds });
    const errorMessage = 'Service failure';
    when(mockedFetchInterviewConversationsService)
      .calledWith(mockSessionIds)
      .mockRejectedValueOnce(new Error(errorMessage));

    const result = await handler(mockEvent as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('Failed to retrieve matching interview logs.');
    expect(JSON.parse(result.body).details).toBe(errorMessage);
  });
});

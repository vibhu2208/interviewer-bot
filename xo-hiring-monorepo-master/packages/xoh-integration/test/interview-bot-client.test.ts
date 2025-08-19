import axios from 'axios';
import {
  InterviewBotClient,
  FetchInterviewConversationsRequest,
  InterviewConversation,
} from '../src/interview-bot-client';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Create a new mock for the instance post method
const mockPost = jest.fn();

describe('InterviewBotClient', () => {
  const baseURL = 'http://fake-api.com';
  let client: InterviewBotClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as any);
    client = new InterviewBotClient(baseURL);
  });

  const mockSessionIds = ['extSub1'];

  const mockRequest: FetchInterviewConversationsRequest = {
    sessionIds: mockSessionIds,
  };

  const mockResponseLogs: InterviewConversation[] = [
    {
      sessionId: 'extSub1',
      questionId: 'q1',
      conversation: [{ role: 'Candidate', content: 'Hello world' }],
    },
  ];

  it('should be created with the correct baseURL', () => {
    expect(mockedAxios.create).toHaveBeenCalledWith({ baseURL });
  });

  describe('fetchInterviewConversations', () => {
    it('should make a POST request to /interview-conversations with correct payload', async () => {
      mockPost.mockResolvedValueOnce({ data: { interviewConversations: mockResponseLogs } });

      await client.fetchInterviewConversations(mockRequest);

      expect(mockPost).toHaveBeenCalledWith('/interview-conversations', mockRequest);
    });

    it('should return data from response on successful request', async () => {
      mockPost.mockResolvedValueOnce({ data: { interviewConversations: mockResponseLogs } });

      const result = await client.fetchInterviewConversations(mockRequest);

      expect(result).toEqual(mockResponseLogs);
    });

    it('should throw an error for non-Axios errors', async () => {
      const nonAxiosError = new Error('Network issue');
      mockPost.mockRejectedValueOnce(nonAxiosError);

      await expect(client.fetchInterviewConversations(mockRequest)).rejects.toThrow(
        'An unexpected error occurred: Network issue',
      );
    });

    it('should throw a generic error for unknown error types', async () => {
      const unknownError = { someProperty: 'someValue' }; // Not an Error instance
      mockPost.mockRejectedValueOnce(unknownError);

      await expect(client.fetchInterviewConversations(mockRequest)).rejects.toThrow(
        'An unexpected error occurred of an unknown type.',
      );
    });
  });
});

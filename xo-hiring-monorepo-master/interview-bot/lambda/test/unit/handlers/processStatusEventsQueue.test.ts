import axios from 'axios';
import { SQSRecord } from 'aws-lambda';
import { handler } from '../../../src/handlers/processStatusEventsQueue';
import { Sqs, SqsStatusEventMessage } from '../../../src/integrations/sqs';

jest.mock('axios');

describe('processStatusEventsQueue', () => {
  test('Should send status event', async () => {
    // Arrange
    (axios.request as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
      },
      status: 200,
    });
    Sqs.sendStatusEventMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify({
            type: 'status-event',
            sessionId: '2',
            callbackUrl: 'https://callback',
            payload: {
              testData: true,
            },
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result).toEqual({
      batchItemFailures: [],
    });
    expect(axios.request).toBeCalledWith({
      data: {
        testData: true,
      },
      method: 'put',
      timeout: 120000,
      url: 'https://callback',
    });
    expect(Sqs.sendStatusEventMessage).toBeCalledTimes(0);
  });

  test('Should retry on bad response', async () => {
    // Arrange
    const message: SqsStatusEventMessage = {
      type: 'status-event',
      sessionId: '2',
      callbackUrl: 'https://callback',
      payload: {
        testData: true,
      } as any,
    };

    (axios.request as jest.Mock).mockResolvedValue({
      data: {
        success: false,
      },
      status: 500,
    });
    Sqs.sendStatusEventMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify(message),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result).toEqual({
      batchItemFailures: [],
    });
    expect(axios.request).toBeCalledWith({
      data: message.payload,
      method: 'put',
      timeout: 120000,
      url: 'https://callback',
    });
    expect(Sqs.sendStatusEventMessage).toBeCalledTimes(1);
    const newMessage = (Sqs.sendStatusEventMessage as jest.Mock).mock.calls[0][0];
    expect(newMessage.retries).toBe(1);
    expect(newMessage.errors).toHaveLength(1);
    expect(newMessage).toMatchObject(message);
  });

  test('Should retry on failed request', async () => {
    // Arrange
    const message: SqsStatusEventMessage = {
      type: 'status-event',
      sessionId: '2',
      callbackUrl: 'https://callback',
      payload: {
        testData: true,
      } as any,
    };

    (axios.request as jest.Mock).mockRejectedValue(new Error('Test Error'));
    Sqs.sendStatusEventMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify(message),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result).toEqual({
      batchItemFailures: [],
    });
    expect(axios.request).toBeCalledWith({
      data: message.payload,
      method: 'put',
      timeout: 120000,
      url: 'https://callback',
    });
    expect(Sqs.sendStatusEventMessage).toBeCalledTimes(1);
    const newMessage = (Sqs.sendStatusEventMessage as jest.Mock).mock.calls[0][0];
    expect(newMessage.retries).toBe(1);
    expect(newMessage.errors).toHaveLength(1);
    expect(newMessage).toMatchObject(message);
  });

  test('Should reject message on retry limit', async () => {
    // Arrange
    const message: SqsStatusEventMessage = {
      type: 'status-event',
      sessionId: '2',
      callbackUrl: 'https://callback',
      payload: {
        testData: true,
      } as any,
      retries: 100,
      errors: [],
    };

    (axios.request as jest.Mock).mockRejectedValue(new Error('Test Error'));
    Sqs.sendStatusEventMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify(message),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result).toEqual({
      batchItemFailures: [
        {
          itemIdentifier: '1',
        },
      ],
    });
    expect(Sqs.sendStatusEventMessage).toBeCalledTimes(0);
  });
});

jest.mock('aws-embedded-metrics', () => {
  const putMetric = jest.fn();
  const putDimensions = jest.fn();
  const setNamespace = jest.fn();
  const flush = jest.fn();

  return {
    createMetricsLogger: () => ({
      putMetric,
      putDimensions,
      setNamespace,
      flush,
    }),
    Unit: {
      None: 'None',
    },
    __esModule: true,
    _mock: {
      putMetric,
      putDimensions,
      setNamespace,
      flush,
    },
  };
});

import { CloudWatchMetrics } from '../../../src/integrations/cloudwatch-metrics';
import { createMetricsLogger } from 'aws-embedded-metrics';

describe('CloudWatchMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('putMetric should forward to putMetrics', async () => {
    const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValueOnce();

    await CloudWatchMetrics.putMetric('TestMetric', 42);
    expect(spy).toHaveBeenCalledWith([{ name: 'TestMetric', value: 42, dimensions: undefined }]);
  });

  it('incrementCounter should call putMetric with value 1', async () => {
    const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValueOnce();

    await CloudWatchMetrics.incrementCounter('CounterMetric');
    expect(spy).toHaveBeenCalledWith('CounterMetric', 1, undefined);
  });

  it('putMetrics should send metrics with and without dimensions', async () => {
    await CloudWatchMetrics.putMetrics([
      { name: 'MetricA', value: 100 },
      {
        name: 'MetricB',
        value: 200,
        dimensions: {
          Env: 'test',
          Region: 'us-west-2',
        },
      },
    ]);

    expect(createMetricsLogger().setNamespace).toHaveBeenCalledWith('InterviewBot');
    expect(createMetricsLogger().putMetric).toHaveBeenCalledWith('MetricA', 100, 'None');
    expect(createMetricsLogger().putMetric).toHaveBeenCalledWith('MetricB', 200, 'None');
    expect(createMetricsLogger().putDimensions).toHaveBeenCalledWith({ Env: 'test', Region: 'us-west-2' });
    expect(createMetricsLogger().flush).toHaveBeenCalled();
  });
});

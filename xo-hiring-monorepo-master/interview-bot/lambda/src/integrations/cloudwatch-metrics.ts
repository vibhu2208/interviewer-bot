import { createMetricsLogger, Unit } from 'aws-embedded-metrics';

export class CloudWatchMetrics {
  static async putMetric(name: string, value: number, dimensions?: Record<string, string>): Promise<void> {
    await this.putMetrics([{ name, value, dimensions }]);
  }

  static async incrementCounter(name: string, dimensions?: Record<string, string>): Promise<void> {
    await this.putMetric(name, 1, dimensions);
  }

  static async putMetrics(
    metrics: { name: string; value: number; dimensions?: Record<string, string> }[],
  ): Promise<void> {
    const logger = createMetricsLogger();
    logger.setNamespace('InterviewBot');

    for (const metric of metrics) {
      if (metric.dimensions) {
        logger.putDimensions(metric.dimensions);
      }

      logger.putMetric(metric.name, metric.value, Unit.None);
    }

    await logger.flush();
  }
}

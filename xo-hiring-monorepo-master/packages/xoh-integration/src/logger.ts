import { Logger, LogItem } from '@aws-lambda-powertools/logger';
import type { ConstructorOptions } from '@aws-lambda-powertools/logger/lib/cjs/types/Logger';
import chalk, { Chalk } from 'chalk';

const rootLoggerInstance = new Logger({ serviceName: 'xoc-integration' });

/**
 * Exposing the method to create a logger with a default configuration without any need to install the package directly.
 * Will be created as a child logger to inherit global configuration.
 * Should be called from the top-level to cache the logger in the runtime.
 * @param [options] Optional logger configuration
 */
export function defaultLogger(options?: ConstructorOptions): Logger {
  return NonJsonLogFormatter.patchIfLocal(rootLoggerInstance.createChild(options));
}

/**
 * Exposing the logger in case we need to configure level specifically for this one.
 */
export function rootLogger(): Logger {
  return rootLoggerInstance;
}

/**
 * Will patch the power tools logger to use the custom printing function that does not format the log items as JSON.
 */
export class NonJsonLogFormatter {
  /**
   * Global configuration for the custom logger
   */
  static Config: NonJsonLogFormatterConfig = {
    printLevel: true,
    printTimestamp: true,
  };

  // Custom color codes
  static LogLevelColors: Record<string, Chalk> = {
    DEBUG: chalk.gray,
    INFO: chalk.green,
    WARN: chalk.yellow,
    ERROR: chalk.red,
    CRITICAL: chalk.bgRed,
    SILENT: chalk.white,
  };

  /**
   * Patch the logger to use the custom logging function that does not format the log items as JSON if the code is running locally.
   * @param logger
   */
  static patchIfLocal(logger: Logger): Logger {
    // This env variable will always be defined in the AWS Lambda environment.
    if (process.env.AWS_LAMBDA_FUNCTION_NAME == null) {
      return NonJsonLogFormatter.patchLogger(logger);
    }
    return logger;
  }

  /**
   * Patch the logger to use the custom logging function that does not format the log items as JSON.
   * @param logger
   */
  static patchLogger(logger: Logger): Logger {
    (logger as any).printLog = NonJsonLogFormatter.log;
    return logger;
  }

  /**
   * Custom message printing function
   * @param level internal numerical level from power tools
   * @param item log item to print
   */
  static log(level: number, item: LogItem): void {
    item.prepareForPrint();
    const attributes: Record<string, any> = item.getAttributes();
    const partsToLog = [];

    if (NonJsonLogFormatter.Config.printTimestamp) {
      partsToLog.push(chalk.cyan(new Date().toISOString()));
    }

    if (NonJsonLogFormatter.Config.printLevel) {
      partsToLog.push(NonJsonLogFormatter.LogLevelColors[attributes.level](attributes.level));
    }

    partsToLog.push(attributes.message);

    if (attributes.error != null) {
      partsToLog.push(attributes.error);
    }

    console.log(...partsToLog);
  }
}

export interface NonJsonLogFormatterConfig {
  printTimestamp: boolean;
  printLevel: boolean;
}

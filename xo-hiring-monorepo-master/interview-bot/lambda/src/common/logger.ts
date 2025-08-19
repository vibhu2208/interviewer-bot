export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private readonly name: string;

  private constructor(name: string) {
    // Include lambda function name if defined
    if (process.env.AWS_LAMBDA_FUNCTION_NAME != null) {
      this.name = `${process.env.AWS_LAMBDA_FUNCTION_NAME}/${name}`;
    } else {
      this.name = name;
    }
  }

  static create(name: string): Logger {
    return new Logger(name);
  }

  error(message: string, ...additionalArgs: any[]): void {
    this.log('error', message, additionalArgs);
  }

  warn(message: string, ...additionalArgs: any[]): void {
    this.log('warn', message, additionalArgs);
  }

  info(message: string, ...additionalArgs: any[]): void {
    this.log('info', message, additionalArgs);
  }

  debug(message: string, ...additionalArgs: any[]): void {
    this.log('debug', message, additionalArgs);
  }

  trace(message: string, ...additionalArgs: any[]): void {
    this.log('trace', message, additionalArgs);
  }

  /**
   * Just log something normally into the console (not a json format)
   * Typically useful when we're going to log huge text (i.e. apigateway events, ddb documents, GPT prompts, etc)
   */
  plain(message: string, ...additionalArgs: any[]): void {
    console.log(message);
    additionalArgs?.forEach((it) => console.log(it));
  }

  /**
   * Extract context from the multiple input objects. We will only extract context fields (to avoid logging too much data)
   */
  context(...contextObjects: any[]): InterviewBotLoggingContext {
    const context: { [key: string]: any } = {};
    contextObjects.forEach((obj) => {
      for (const fieldName in obj) {
        if (ContextFields.includes(fieldName) && obj[fieldName] !== undefined) {
          context[fieldName] = obj[fieldName];
        }
      }
    });
    return context as InterviewBotLoggingContext;
  }

  /**
   * A generic logging method that will output JSON-formatted message into the stdout
   * @param level Log level
   * @param message The message itself
   * @param additionalArgs error object and/or context object. Both will be added to the json output
   */
  private log(level: LogLevel, message: string, additionalArgs: any[]): void {
    const outputObj: LogMessage = {
      name: this.name,
      level,
      message,
    };

    additionalArgs.forEach((arg) => {
      if (arg instanceof Error) {
        // Log error like this to properly serialize it
        outputObj.error = {
          message: arg.message,
          stack: arg.stack,
          name: arg.name,
        };
      } else if (typeof arg === 'object') {
        // Assume this is a context object, just add its fields to the context
        if (outputObj.context === undefined) {
          outputObj.context = {};
        }
        for (const fieldName in arg) {
          if (arg[fieldName] === undefined) {
            continue;
          }
          outputObj.context[fieldName] = arg[fieldName];
        }
      } else {
        // The rest types would be logged into array
        if (outputObj.additions === undefined) {
          outputObj.additions = [];
        }
        outputObj.additions.push(arg);
      }
    });

    console.log(JSON.stringify(outputObj, null, 2));
  }
}

/**
 * Used to extract context from the different objects, should match InterviewBotLoggingContext type
 */
const ContextFields = ['sessionId', 'questionId', 'skillId'];

export interface InterviewBotLoggingContext {
  sessionId?: string;
  questionId?: string;
  skillId?: string;
}

interface LogMessage {
  level: LogLevel;
  name: string;
  message: string;
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
  context?: {
    [key: string]: any;
  };
  additions?: any[];
}

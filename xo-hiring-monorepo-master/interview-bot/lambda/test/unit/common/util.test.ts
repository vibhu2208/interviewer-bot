import { replacePlaceholders } from '../../../src/common/util';
import { SessionDocument } from '../../../src/model/session';

describe('replacePlaceholders', () => {
  test('should replace placeholders with nested values', () => {
    // Arrange
    const prompt =
      'Hello, {{#if session.testTaker.name}}{{session.testTaker.name}}{{else}}N/A{{/if}}. The session started at {{#if session.startTime}}{{session.startTime}}{{else}}N/A{{/if}}';
    const session = {
      testTaker: {
        name: 'John Doe',
      },
      startTime: '2024-01-01T00:00:00Z',
    } as SessionDocument;

    // Act
    const result = replacePlaceholders(prompt, { session });

    // Assert
    expect(result).toBe('Hello, John Doe. The session started at 2024-01-01T00:00:00Z');
  });

  test('should return N/A if placeholder is not found', () => {
    // Arrange
    const prompt =
      'You should ask {{#if session.testTaker.name}}{{session.testTaker.name}}{{else}}N/A{{/if}} about {{#if session.skill.name}}{{session.skill.name}}{{else}}N/A{{/if}}';
    const session = {
      testTaker: {
        name: 'John Doe',
      },
    } as SessionDocument;

    // Act
    const result = replacePlaceholders(prompt, { session });

    // Assert
    expect(result).toBe('You should ask John Doe about N/A');
  });

  test('should return N/A if value is null or empty string', () => {
    // Arrange
    const prompt =
      'Hello, {{#if session.testTaker.name}}{{session.testTaker.name}}{{else}}N/A{{/if}} {{#if session.testTaker.email}}{{session.testTaker.email}}{{else}}N/A{{/if}}';
    const session = {
      testTaker: {
        name: null as string | null,
        email: '',
      },
    } as SessionDocument;

    // Act
    const result = replacePlaceholders(prompt, { session });

    // Assert
    expect(result).toBe('Hello, N/A N/A');
  });

  test('should replace currentTime with current date and time', () => {
    // Arrange
    const prompt = 'The current time is {{#if currentTime}}{{currentTime}}{{else}}N/A{{/if}}';
    const currentTime = new Date().toISOString();

    // Act
    const result = replacePlaceholders(prompt, { currentTime });

    // Assert
    expect(result).toBe(`The current time is ${currentTime}`);
  });

  test('should return the original prompt if it is null', () => {
    // Arrange
    const prompt = null;
    const data = {};

    // Act
    const result = replacePlaceholders(prompt, data);

    // Assert
    expect(result).toBe(prompt);
  });

  test('should replace array index', () => {
    // Arrange
    const prompt =
      'The second item is {{#if items.[1].name}}{{items.[1].name}}{{else}}N/A{{/if}} and another item is {{#if items.[4].name}}{{items.[4].name}}{{else}}N/A{{/if}}';
    const items = [{ name: 'apple' }, { name: 'banana' }, { name: 'cherry' }];

    // Act
    const result = replacePlaceholders(prompt, { items });

    // Assert
    expect(result).toBe('The second item is banana and another item is N/A');
  });

  test('should return N/A if context is null', () => {
    // Arrange
    const prompt = 'The second item is {{#if items.[1].name}}{{items.[1].name}}{{else}}N/A{{/if}}';

    // Act
    const result = replacePlaceholders(prompt, null);

    // Assert
    expect(result).toBe('The second item is N/A');
  });
});

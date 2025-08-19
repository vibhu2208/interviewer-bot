import { getEnvironmentType, getStableEnvironmentName, EnvironmentType } from '../src';

describe('Environment Utilities', () => {
  describe('getEnvironmentType', () => {
    it('should return Production for "production"', () => {
      expect(getEnvironmentType('production')).toBe(EnvironmentType.Production);
    });

    it('should return Preview for names starting with "pr"', () => {
      expect(getEnvironmentType('preview')).toBe(EnvironmentType.Preview);
      expect(getEnvironmentType('pr123')).toBe(EnvironmentType.Preview);
    });

    it('should return Preview for other names', () => {
      expect(getEnvironmentType('sandbox')).toBe(EnvironmentType.Sandbox);
      expect(getEnvironmentType('development')).toBe(EnvironmentType.Preview);
    });

    it('should default to Preview if no name is provided', () => {
      expect(getEnvironmentType()).toBe(EnvironmentType.Preview);
    });
  });

  describe('getStableEnvironmentName', () => {
    it('should return "production" for Production environment type', () => {
      expect(getStableEnvironmentName(EnvironmentType.Production)).toBe('production');
    });

    it('should return "sandbox" for non-Production environment types', () => {
      expect(getStableEnvironmentName(EnvironmentType.Sandbox)).toBe('sandbox');
      expect(getStableEnvironmentName(EnvironmentType.Preview)).toBe('sandbox');
    });

    it('should use the default environment type if none is provided', () => {
      expect(getStableEnvironmentName()).toBe('sandbox');
    });
  });
});

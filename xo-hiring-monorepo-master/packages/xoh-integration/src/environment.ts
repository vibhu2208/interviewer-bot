export const enum EnvironmentType {
  Production = 'production',
  Sandbox = 'sandbox',
  Preview = 'preview',
}

/**
 * Get the current environment type. Defaults to preview.
 * @param [name] The name of the environment.
 */
export function getEnvironmentType(name?: string): EnvironmentType {
  const env = name ?? process.env.ENV ?? '';

  switch (env) {
    case EnvironmentType.Production:
      return EnvironmentType.Production;
    case EnvironmentType.Sandbox:
      return EnvironmentType.Sandbox;
    default:
      return EnvironmentType.Preview;
  }
}

/**
 * Return the stable environment name for this environment type.
 * @param [type] The environment type.
 */
export function getStableEnvironmentName(type: EnvironmentType = getEnvironmentType()): string {
  switch (type) {
    case EnvironmentType.Production:
      return EnvironmentType.Production;
    default:
      return EnvironmentType.Sandbox;
  }
}

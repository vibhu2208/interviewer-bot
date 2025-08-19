export interface Persona {
  chat: (botMessage: string) => Promise<string>;
  name: string;
  prompt: string;
}

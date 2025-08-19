import * as AwsSes from '@aws-sdk/client-ses';
import { createTransport, Transporter } from 'nodemailer';
import { Config } from '../config';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Secrets } from './secrets';

let transporter: Transporter | null = null;

export class Email {
  static async getTransporter(): Promise<Transporter> {
    if (transporter != null) {
      return transporter;
    }

    if (Config.shouldMockEmails()) {
      transporter = await Email.getMailosaurTransporter();
    } else {
      transporter = Email.getSESTransporter();
    }

    return transporter;
  }

  static getSESTransporter(): Transporter {
    const ses = new AwsSes.SES({
      apiVersion: '2010-12-01',
      region: Config.getRegion(),
      credentialDefaultProvider: defaultProvider,
    });

    return createTransport({
      SES: { ses, aws: AwsSes },
    });
  }

  static async getMailosaurTransporter(): Promise<Transporter> {
    const config = await Secrets.fetchJsonSecret<MailosaurConfig>(Config.getMailosaurSecret());

    return createTransport({
      host: config.host,
      port: 587,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });
  }
}

interface MailosaurConfig {
  host: string;
  username: string;
  password: string;
}

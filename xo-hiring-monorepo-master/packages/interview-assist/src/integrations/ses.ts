import * as AwsSes from '@aws-sdk/client-ses';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { createTransport, Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export class Email {
  static getTransporter(): Transporter {
    if (transporter != null) {
      return transporter;
    }

    const ses = new AwsSes.SES({
      apiVersion: '2010-12-01',
      region: process.env.AWS_REGION,
      credentialDefaultProvider: defaultProvider,
    });

    transporter = createTransport({
      SES: { ses, aws: AwsSes },
    });

    return transporter;
  }
}

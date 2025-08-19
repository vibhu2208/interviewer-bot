import * as AwsSes from '@aws-sdk/client-ses';
import { createTransport, Transporter } from 'nodemailer';
import { Config } from '../config';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

let transporter: Transporter | null = null;

export class Email {
  static getTransporter(): Transporter {
    if (transporter != null) {
      return transporter;
    }

    const ses = new AwsSes.SES({
      apiVersion: '2010-12-01',
      region: Config.getRegion(),
      credentialDefaultProvider: defaultProvider,
    });

    transporter = createTransport({
      SES: { ses, aws: AwsSes },
    });

    return transporter;
  }
}

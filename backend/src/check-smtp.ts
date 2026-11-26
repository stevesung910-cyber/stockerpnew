import "dotenv/config";
import { SmtpEmailDeliveryProvider, smtpConfiguration } from "./modules/auth/smtp-email-delivery";

async function checkSmtp() {
  try {
    const config = smtpConfiguration();
    if (!config) {
      process.stderr.write("Set EMAIL_DELIVERY_PROVIDER=smtp before checking SMTP.\n");
      process.exitCode = 1;
      return;
    }
    const provider = new SmtpEmailDeliveryProvider(config);
    await provider.verify();
    process.stdout.write("SMTP connection and authentication succeeded. No email was sent.\n");
  } catch {
    process.stderr.write("SMTP check failed. Check the backend SMTP settings, App Password and network access.\n");
    process.exitCode = 1;
  }
}

void checkSmtp();

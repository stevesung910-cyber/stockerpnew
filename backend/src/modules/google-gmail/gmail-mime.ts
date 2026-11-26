import { randomUUID } from "node:crypto";
import type { OutboundEmail } from "../auth/email-delivery";

const atom = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const label = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const mailbox = new RegExp(`^${atom}(?:\\.${atom})*@${label}(?:\\.${label})+$`);

export function isGmailMailbox(value: string) {
  return value.length <= 254 && value.indexOf("@") <= 64 && !/[\s\p{C}]/u.test(value) && mailbox.test(value);
}

export function gmailMime(sender: string, { to, subject, text }: OutboundEmail) {
  if (!isGmailMailbox(to)) throw new Error("Invalid Gmail recipient address.");
  if (/[\r\n\u0000]/.test(subject)) throw new Error("Invalid Gmail message subject.");

  // Fold at complete UTF-8 code points within RFC 2047's encoded-word limit.
  const subjectParts: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 42) {
      subjectParts.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) subjectParts.push(chunk);
  const encodedSubject = subjectParts.map(part => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
  const body = Buffer.from(text.replace(/\r\n|\r|\n/g, "\r\n")).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return Buffer.from([
    `From: ${sender}`, `To: ${to}`, `Subject: ${encodedSubject}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${sender.split("@")[1]}>`, "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", body, "",
  ].join("\r\n")).toString("base64url");
}

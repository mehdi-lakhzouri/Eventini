declare module 'nodemailer' {
  interface Transporter {
    sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
  }

  interface NodemailerApi {
    createTransport(options: Record<string, unknown>): Transporter;
  }

  const nodemailer: NodemailerApi;
  export default nodemailer;
}

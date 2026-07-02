/** Public surface for the email module. */
export {
  sendEmail,
  isEmailConfigured,
  DEFAULT_EMAIL_FROM,
  type SendEmailInput,
  type SendEmailResult,
  type SendEmailDeps,
} from "./send"
export {
  renderInvoiceEmailHtml,
  renderQuoteEmailHtml,
  invoiceEmailSubject,
  quoteEmailSubject,
  escapeHtml,
  type InvoiceEmailInput,
  type QuoteEmailInput,
} from "./render"

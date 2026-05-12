require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const INVOICE_PROMPT = require('../prompts/invoice');
const PO_PROMPT = require('../prompts/po');
const DO_PROMPT = require('../prompts/do');

const client = new Anthropic();

// ── Error types ──────────────────────────────────────
const ERRORS = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  EMPTY_PDF: 'EMPTY_PDF',
  SCANNED_PDF: 'SCANNED_PDF',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  UNKNOWN_DOC_TYPE: 'UNKNOWN_DOC_TYPE'
};

/**
 * Creates a structured error object
 * @param {string} type - Error type from ERRORS constant
 * @param {string} message - Human readable error message
 * @param {string} filePath - File that caused the error
 */
function createError(type, message, filePath) {
  return { type, message, filePath, timestamp: new Date().toISOString() };
}

/**
 * Strips markdown formatting from Claude's text output
 * @param {string} raw - Raw text from Claude
 * @returns {string} Cleaned plain text
 */
function cleanText(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/#{1,6} /g, '')
    .replace(/\*\*/g, '')
    .replace(/\|/g, ' ')
    .trim();
}

/**
 * Strips markdown code fences from JSON responses
 * @param {string} raw - Raw JSON string possibly wrapped in backticks
 * @returns {string} Clean JSON string
 */
function cleanJSON(raw) {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * Validates extracted text — catches empty and scanned PDFs early
 * @param {string} text - Extracted text to validate
 * @param {string} filePath - Source file path for error reporting
 * @throws {Object} Structured error if validation fails
 */
function validateText(text, filePath) {
  if (!text || text.trim().length === 0) {
    throw createError(
      ERRORS.EMPTY_PDF,
      'No text found. This may be a scanned document.',
      filePath
    );
  }
  if (text.replace(/\s/g, '').length < 100) {
    throw createError(
      ERRORS.SCANNED_PDF,
      'This appears to be a scanned document. Please retype the key details.',
      filePath
    );
  }
}

/**
 * Reads a PDF file and returns extracted text via Claude
 * @param {string} filePath - Path to PDF file
 * @returns {string} Extracted text content
 * @throws {Object} Structured error if file cannot be read
 */
async function readPDF(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },
          {
            type: 'text',
            text: 'Extract all text content from this document exactly as it appears. Return every field, value, date, amount, and address. Do not summarise.'
          }
        ]
      }]
    });

    return response.content[0].text;
  } catch (e) {
    throw createError(
      ERRORS.FILE_NOT_FOUND,
      'Could not read this file. Is it a valid PDF?',
      filePath
    );
  }
}

/**
 * Reads a document file — supports PDF and TXT
 * @param {string} filePath - Path to the document
 * @returns {string} Raw text content
 * @throws {Object} Structured error for unsupported types
 */
async function readDocument(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();

  if (ext === 'txt') {
    return fs.readFileSync(filePath, 'utf8');
  } else if (ext === 'pdf') {
    return await readPDF(filePath);
  } else {
    throw createError(
      ERRORS.UNSUPPORTED_TYPE,
      `Unsupported file type: .${ext}. Only PDF and TXT are supported.`,
      filePath
    );
  }
}

/**
 * Detects document type using Claude classification
 * @param {string} text - Cleaned document text
 * @returns {string} Document type: invoice, purchase_order, or delivery_order
 */
async function detectDocumentType(text) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 10,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `What type of document is this? Reply with ONE word only: invoice, purchase_order, or delivery_order.\n\n${text.substring(0, 500)}`
    }]
  });

  return response.content[0].text.trim().toLowerCase();
}

/**
 * Selects the correct extraction prompt based on document type
 * @param {string} documentType - Detected document type
 * @returns {string} System prompt for extraction
 */
function selectPrompt(documentType) {
  switch (documentType) {
    case 'invoice': return INVOICE_PROMPT;
    case 'purchase_order': return PO_PROMPT;
    case 'delivery_order': return DO_PROMPT;
    default: return INVOICE_PROMPT;
  }
}

/**
 * Extracts structured fields from cleaned text using the correct prompt
 * @param {string} text - Cleaned document text
 * @param {string} prompt - System prompt for this document type
 * @returns {Object} Parsed JSON with extracted fields
 * @throws {Object} Structured error if JSON parsing fails
 */
async function extractFields(text, prompt) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    temperature: 0,
    system: prompt,
    messages: [{ role: 'user', content: text }]
  });

  try {
    const raw = response.content[0].text;
    const cleaned = cleanJSON(raw);
    return JSON.parse(cleaned);
  } catch (e) {
    throw createError(
      ERRORS.EXTRACTION_FAILED,
      'Extraction failed. Claude returned unexpected output.',
      text
    );
  }
}

/**
 * Main entry point — processes any document file end to end
 * Accepts PDF or TXT, detects type, extracts structured fields
 * @param {string} filePath - Path to the document to process
 * @returns {Object} { success: boolean, data?: Object, error?: Object }
 */
async function extractFromDocument(filePath) {
  // Check file exists
  if (!fs.existsSync(filePath)) {
    const err = createError(ERRORS.FILE_NOT_FOUND, `File not found: ${filePath}`, filePath);
    return { success: false, error: err };
  }

  try {
    const rawText = await readDocument(filePath);
    const cleaned = cleanText(rawText);
    validateText(cleaned, filePath);

    const docType = await detectDocumentType(cleaned);

    if (!['invoice', 'purchase_order', 'delivery_order'].includes(docType)) {
      throw createError(
        ERRORS.UNKNOWN_DOC_TYPE,
        `Could not determine document type. Got: "${docType}"`,
        filePath
      );
    }

    const prompt = selectPrompt(docType);
    const result = await extractFields(cleaned, prompt);

    return { success: true, data: result };

  } catch (err) {
    if (err.type) {
      return { success: false, error: err };
    }
    return {
      success: false,
      error: createError('UNEXPECTED_ERROR', err.message, filePath)
    };
  }
}

module.exports = { extractFromDocument };
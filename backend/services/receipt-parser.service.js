import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * Normalizes amount string (e.g. "1 500,00 ₽" -> 1500)
 */
function normalizeAmount(value) {
    if (!value) return null;
    const normalized = String(value)
        .replace(/\s+/g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Parses Russian date/time string (DD.MM.YYYY HH:MM:SS or DD.MM.YYYY) into ISO string
 */
function parseRussianDateTime(str) {
    if (!str) return null;
    const match = str.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    if (!match) return null;
    const [_, day, month, year, hour = '12', minute = '00', second = '00'] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Parses the raw text extracted from a bank receipt PDF.
 * Supports Sberbank and Tinkoff/T-Bank formats.
 */
export function parseReceiptText(text) {
    if (!text) {
        return { success: false, reason: 'Empty text' };
    }

    const cleanText = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    
    let bankName = 'Unknown';
    let amountRub = null;
    let eventTime = null;
    let transactionId = null;

    // Detect Bank
    const isSber = /сбербанк|сбер\b/i.test(cleanText) || /чек по операции/i.test(cleanText);
    const isTinkoff = /тинькофф|т-банк|t-bank|tinkoff/i.test(cleanText) || /квитанция о переводе/i.test(cleanText);

    if (isSber) {
        bankName = 'Сбербанк';
        
        // Sberbank Amount
        // e.g. "Сумма перевода 1 500,00 руб." or "Сумма 1 500,00 руб." or "Сумма операции 1500.00 руб"
        const amountMatch = cleanText.match(/(?:сумма перевода|сумма операции|сумма|всего)\s*[:]?\s*([\d\s]+(?:[.,]\d{2})?)\s*(?:руб|₽)/i);
        if (amountMatch) {
            amountRub = normalizeAmount(amountMatch[1]);
        }

        // Sberbank Date & Time
        // e.g. "Дата операции: 12.06.2026 15:30:11"
        const dateMatch = cleanText.match(/(?:дата операции|дата и время|дата)\s*[:]?\s*(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)/i);
        if (dateMatch) {
            eventTime = parseRussianDateTime(dateMatch[1]);
        }

        // Sberbank Transaction ID
        // e.g. "Номер операции: 123456789012"
        const txMatch = cleanText.match(/(?:номер операции|код авторизации|номер транзакции)\s*[:]?\s*(\d{5,20})/i);
        if (txMatch) {
            transactionId = txMatch[1];
        }

    } else if (isTinkoff) {
        bankName = 'Т-Банк';

        // Tinkoff Amount
        // e.g. "Сумма перевода 1 500 ₽" or "Сумма 1 500,00 ₽"
        const amountMatch = cleanText.match(/(?:сумма перевода|сумма операции|сумма)\s*[:]?\s*([\d\s]+(?:[.,]\d{2})?)\s*(?:₽|руб|rub)/i)
            || cleanText.match(/([\d\s]+(?:[.,]\d{2})?)\s*(?:₽)/);
        if (amountMatch) {
            amountRub = normalizeAmount(amountMatch[1]);
        }

        // Tinkoff Date & Time
        // e.g. "Дата и время: 12.06.2026 15:30:11"
        const dateMatch = cleanText.match(/(?:дата и время|дата платежа|дата операции|дата)\s*[:]?\s*(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)/i);
        if (dateMatch) {
            eventTime = parseRussianDateTime(dateMatch[1]);
        }

        // Tinkoff Transaction ID / RRN
        // e.g. "Номер операции: 123456789012" or "RRN: 123456789012"
        const txMatch = cleanText.match(/(?:номер операции|идентификатор операции|rrn)\s*[:]?\s*(\d{5,25})/i);
        if (txMatch) {
            transactionId = txMatch[1];
        }
    } else {
        // Fallback generic parser for other banks
        // Look for any decimal amount near currency symbol
        const amountMatch = cleanText.match(/сумма[^\d]{0,20}(\d[\d\s]*(?:[.,]\d{2})?)\s*(?:₽|руб|rub)/i)
            || cleanText.match(/(\d[\d\s]*(?:[.,]\d{2})?)\s*(?:₽|руб)/i);
        if (amountMatch) {
            amountRub = normalizeAmount(amountMatch[1]);
        }

        const dateMatch = cleanText.match(/(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)/);
        if (dateMatch) {
            eventTime = parseRussianDateTime(dateMatch[1]);
        }

        const txMatch = cleanText.match(/(?:номер|id|транзакция|операция)[^\d]{0,20}(\d{6,25})/i);
        if (txMatch) {
            transactionId = txMatch[1];
        }
    }

    if (!amountRub) {
        return {
            success: false,
            reason: 'Could not extract amount',
            bankName,
            textExcerpt: cleanText.slice(0, 300)
        };
    }

    return {
        success: true,
        bankName,
        amountRub,
        eventTime,
        transactionId,
        textExcerpt: cleanText.slice(0, 300)
    };
}

/**
 * Extracts and parses metadata from an uploaded PDF bank receipt file.
 * @param {string} filePath - Absolute path to the PDF file on disk.
 */
export async function parsePdfReceipt(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, reason: `File not found: ${filePath}` };
        }

        const dataBuffer = fs.readFileSync(filePath);
        
        // Parse PDF text
        const pdfData = await pdfParse(dataBuffer);
        const parsed = parseReceiptText(pdfData.text);

        return {
            ...parsed,
            isPdf: true,
            parsedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Error parsing PDF receipt:', error);
        return {
            success: false,
            reason: `PDF parsing error: ${error.message}`,
            parsedAt: new Date().toISOString()
        };
    }
}

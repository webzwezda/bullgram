import { parseReceiptText } from '../services/receipt-parser.service.js';

const mockSberbankReceipt = `
ПАО Сбербанк
ЧЕК ПО ОПЕРАЦИИ
ДАТА ОПЕРАЦИИ: 12.06.2026 15:30:11
НОМЕР ОПЕРАЦИИ: 998877665544
ОТПРАВИТЕЛЬ: ИВАН ИВАНОВИЧ И.
ПОЛУЧАТЕЛЬ: ПЕТР ПЕТРОВИЧ П.
СУММА ПЕРЕВОДА: 1 500,00 руб.
КОМИССИЯ: 0.00 руб.
СПИСАНО: 1 500,00 руб.
`;

const mockTinkoffReceipt = `
Квитанция о переводе
АО «Тинькофф Банк»
ИНН 7710140679
Дата и время: 12.06.2026 15:30:11
ФИО отправителя: ИВАН ИВАНОВИЧ И.
ФИО получателя: ПЕТР ПЕТРОВИЧ П.
Банк получателя: Т-Банк
Сумма перевода: 1 500 ₽
Идентификатор операции: 123456789012
RRN: 123456789012
`;

function test() {
    console.log("--- Testing Sberbank Receipt Parser ---");
    const sberResult = parseReceiptText(mockSberbankReceipt);
    console.log(JSON.stringify(sberResult, null, 2));
    if (sberResult.success && sberResult.amountRub === 1500 && sberResult.bankName === 'Сбербанк' && sberResult.transactionId === '998877665544') {
        console.log("✅ Sberbank parse successful.");
    } else {
        console.error("❌ Sberbank parse failed!");
        process.exit(1);
    }

    console.log("\n--- Testing Tinkoff Receipt Parser ---");
    const tinkoffResult = parseReceiptText(mockTinkoffReceipt);
    console.log(JSON.stringify(tinkoffResult, null, 2));
    if (tinkoffResult.success && tinkoffResult.amountRub === 1500 && tinkoffResult.bankName === 'Т-Банк' && tinkoffResult.transactionId === '123456789012') {
        console.log("✅ Tinkoff parse successful.");
    } else {
        console.error("❌ Tinkoff parse failed!");
        process.exit(1);
    }

    console.log("\nAll unit tests passed successfully!");
}

test();

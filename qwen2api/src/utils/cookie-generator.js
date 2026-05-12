// 匯入指紋生成器
const { generateFingerprint } = require('./fingerprint');

// 自定義Base64字元表
const CUSTOM_BASE64_CHARS = "DGi0YA7BemWnQjCl4_bR3f8SKIF9tUz/xhr2oEOgPpac=61ZqwTudLkM5vHyNXsVJ";

// 雜湊欄位位置（這些欄位需要隨機生成）
const HASH_FIELDS = {
    16: 'split',  // 外掛雜湊（格式: count|hash，只替換hash部分）
    17: 'full',   // Canvas指紋雜湊
    18: 'full',   // UserAgent雜湊
    31: 'full',   // UserAgent雜湊2
    34: 'full',   // 檔案URL雜湊
    36: 'full'    // 檔案屬性雜湊
};

// ==================== LZW壓縮演算法 ====================

function lzwCompress(data, bits, charFunc) {
    if (data == null) return '';

    let dict = {};
    let dictToCreate = {};
    let c = '';
    let wc = '';
    let w = '';
    let enlargeIn = 2;
    let dictSize = 3;
    let numBits = 2;
    let result = [];
    let value = 0;
    let position = 0;

    for (let i = 0; i < data.length; i++) {
        c = data.charAt(i);

        if (!Object.prototype.hasOwnProperty.call(dict, c)) {
            dict[c] = dictSize++;
            dictToCreate[c] = true;
        }

        wc = w + c;

        if (Object.prototype.hasOwnProperty.call(dict, wc)) {
            w = wc;
        } else {
            if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
                if (w.charCodeAt(0) < 256) {
                    for (let j = 0; j < numBits; j++) {
                        value = (value << 1);
                        if (position === bits - 1) {
                            position = 0;
                            result.push(charFunc(value));
                            value = 0;
                        } else {
                            position++;
                        }
                    }

                    let charCode = w.charCodeAt(0);
                    for (let j = 0; j < 8; j++) {
                        value = (value << 1) | (charCode & 1);
                        if (position === bits - 1) {
                            position = 0;
                            result.push(charFunc(value));
                            value = 0;
                        } else {
                            position++;
                        }
                        charCode >>= 1;
                    }
                } else {
                    let charCode = 1;
                    for (let j = 0; j < numBits; j++) {
                        value = (value << 1) | charCode;
                        if (position === bits - 1) {
                            position = 0;
                            result.push(charFunc(value));
                            value = 0;
                        } else {
                            position++;
                        }
                        charCode = 0;
                    }

                    charCode = w.charCodeAt(0);
                    for (let j = 0; j < 16; j++) {
                        value = (value << 1) | (charCode & 1);
                        if (position === bits - 1) {
                            position = 0;
                            result.push(charFunc(value));
                            value = 0;
                        } else {
                            position++;
                        }
                        charCode >>= 1;
                    }
                }

                enlargeIn--;
                if (enlargeIn === 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                }
                delete dictToCreate[w];
            } else {
                let charCode = dict[w];
                for (let j = 0; j < numBits; j++) {
                    value = (value << 1) | (charCode & 1);
                    if (position === bits - 1) {
                        position = 0;
                        result.push(charFunc(value));
                        value = 0;
                    } else {
                        position++;
                    }
                    charCode >>= 1;
                }
            }

            enlargeIn--;
            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }

            dict[wc] = dictSize++;
            w = String(c);
        }
    }

    if (w !== '') {
        if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) {
            if (w.charCodeAt(0) < 256) {
                for (let j = 0; j < numBits; j++) {
                    value = (value << 1);
                    if (position === bits - 1) {
                        position = 0;
                        result.push(charFunc(value));
                        value = 0;
                    } else {
                        position++;
                    }
                }

                let charCode = w.charCodeAt(0);
                for (let j = 0; j < 8; j++) {
                    value = (value << 1) | (charCode & 1);
                    if (position === bits - 1) {
                        position = 0;
                        result.push(charFunc(value));
                        value = 0;
                    } else {
                        position++;
                    }
                    charCode >>= 1;
                }
            } else {
                let charCode = 1;
                for (let j = 0; j < numBits; j++) {
                    value = (value << 1) | charCode;
                    if (position === bits - 1) {
                        position = 0;
                        result.push(charFunc(value));
                        value = 0;
                    } else {
                        position++;
                    }
                    charCode = 0;
                }

                charCode = w.charCodeAt(0);
                for (let j = 0; j < 16; j++) {
                    value = (value << 1) | (charCode & 1);
                    if (position === bits - 1) {
                        position = 0;
                        result.push(charFunc(value));
                        value = 0;
                    } else {
                        position++;
                    }
                    charCode >>= 1;
                }
            }

            enlargeIn--;
            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }
            delete dictToCreate[w];
        } else {
            let charCode = dict[w];
            for (let j = 0; j < numBits; j++) {
                value = (value << 1) | (charCode & 1);
                if (position === bits - 1) {
                    position = 0;
                    result.push(charFunc(value));
                    value = 0;
                } else {
                    position++;
                }
                charCode >>= 1;
            }
        }

        enlargeIn--;
        if (enlargeIn === 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }

    let charCode = 2;
    for (let j = 0; j < numBits; j++) {
        value = (value << 1) | (charCode & 1);
        if (position === bits - 1) {
            position = 0;
            result.push(charFunc(value));
            value = 0;
        } else {
            position++;
        }
        charCode >>= 1;
    }

    while (true) {
        value = (value << 1);
        if (position === bits - 1) {
            result.push(charFunc(value));
            break;
        }
        position++;
    }

    return result.join('');
}

// ==================== 編碼函式 ====================

function customEncode(data, urlSafe) {
    if (data == null) return '';

    const base64Chars = CUSTOM_BASE64_CHARS;

    let compressed = lzwCompress(data, 6, function(index) {
        return base64Chars.charAt(index);
    });

    if (!urlSafe) {
        switch (compressed.length % 4) {
            case 1: return compressed + '===';
            case 2: return compressed + '==';
            case 3: return compressed + '=';
            default: return compressed;
        }
    }

    return compressed;
}

// ==================== 輔助函式 ====================

function randomHash() {
    return Math.floor(Math.random() * 4294967296);
}

function generateDeviceId() {
    return Array.from({ length: 20 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');
}

// ==================== 資料解析和處理 ====================

function parseRealData(realData) {
    const fields = realData.split('^');
    return fields;
}

function processFields(fields) {
    const processed = [...fields];
    const currentTimestamp = Date.now();

    // 替換雜湊欄位
    for (const [index, type] of Object.entries(HASH_FIELDS)) {
        const idx = parseInt(index);

        if (type === 'split') {
            // 欄位16: 格式為 "count|hash"，只替換hash部分
            const parts = processed[idx].split('|');
            if (parts.length === 2) {
                processed[idx] = `${parts[0]}|${randomHash()}`;
            }
        } else if (type === 'full') {
            // 完全替換為隨機雜湊
            if (idx === 36) {
                // 欄位36: 檔案屬性雜湊（10-100的隨機整數）
                processed[idx] = Math.floor(Math.random() * 91) + 10;
            } else {
                processed[idx] = randomHash();
            }
        }
    }

    processed[33] = currentTimestamp;  // 欄位33: 當前時間戳

    return processed;
}

// ==================== Cookie生成 ====================

function generateCookies(realData = null, fingerprintOptions = {}) {
    // 使用傳入的指紋或生成新的隨機指紋
    const fingerprint = realData || generateFingerprint(fingerprintOptions);

    // 解析指紋資料
    const fields = parseRealData(fingerprint);

    // 處理欄位（隨機化雜湊，更新時間戳）
    const processedFields = processFields(fields);

    // 生成 ssxmod_itna (37欄位)
    const ssxmod_itna_data = processedFields.join('^');
    const ssxmod_itna = '1-' + customEncode(ssxmod_itna_data, true);

    // 生成 ssxmod_itna2 (18欄位)
    // 只使用: 欄位0, 欄位1, 欄位23, 欄位32, 欄位33
    const ssxmod_itna2_data = [
        processedFields[0],   // 裝置ID
        processedFields[1],   // SDK版本
        processedFields[23],  // 模式 (P/M)
        0, '', 0, '', '', 0,  // 事件相關（P模式下為空）
        0, 0,
        processedFields[32],  // 常量 (11)
        processedFields[33],  // 當前時間戳
        0, 0, 0, 0, 0
    ].join('^');
    const ssxmod_itna2 = '1-' + customEncode(ssxmod_itna2_data, true);

    return {
        ssxmod_itna,
        ssxmod_itna2,
        timestamp: parseInt(processedFields[33]),
        rawData: ssxmod_itna_data,
        rawData2: ssxmod_itna2_data
    };
}

function generateBatch(count = 10, realData = null, fingerprintOptions = {}) {
    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(generateCookies(realData, fingerprintOptions));
    }
    return results;
}

// ==================== 主程式 ====================

if (require.main === module) {
    const result = generateCookies();
    console.log('ssxmod_itna:', result.ssxmod_itna);
    console.log('ssxmod_itna2:', result.ssxmod_itna2);
}

// ==================== 匯出 ====================

module.exports = {
    generateCookies,
    generateBatch,
    customEncode,
    randomHash,
    generateDeviceId,
    parseRealData,
    generateFingerprint
};

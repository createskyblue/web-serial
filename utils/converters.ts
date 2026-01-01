
export const uint8ArrayToHex = (arr: Uint8Array): string => {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
};

export const hexToUint8Array = (hex: string): Uint8Array => {
  const cleanHex = hex.replace(/[^0-9A-Fa-f]/g, '');
  if (cleanHex.length % 2 !== 0) {
    throw new Error('无效的十六进制字符串');
  }
  const result = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    result[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return result;
};

export const stringToUint8Array = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

export const uint8ArrayToString = (arr: Uint8Array): string => {
  return new TextDecoder().decode(arr);
};

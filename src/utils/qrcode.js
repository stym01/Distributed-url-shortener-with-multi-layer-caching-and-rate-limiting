import QRCode from 'qrcode';

export const generateQRCode = async (url) => {
    try {
        
        return await QRCode.toDataURL(url);
    } catch (err) {
        console.error('Failed to generate QR code', err);
        return null;
    }
};
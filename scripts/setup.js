import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), '.env');
if (existsSync(path)) {
  console.log('Đã có file .env. Không ghi đè để tránh đổi mật khẩu hoặc mất phiên đăng nhập.');
  process.exit(0);
}
const password = randomBytes(18).toString('base64url');
const secret = randomBytes(48).toString('hex');
writeFileSync(path, `PORT=3000\nAPP_PASSWORD=${password}\nSESSION_SECRET=${secret}\nNODE_ENV=development\nMAX_UPLOAD_MB=150\n`, {mode: 0o600});
console.log('\nĐã tạo cấu hình an toàn trong file .env');
console.log(`MẬT KHẨU ĐĂNG NHẬP: ${password}`);
console.log('Lưu lại mật khẩu ở nơi an toàn. Sau đó chạy: npm start');

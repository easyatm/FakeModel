import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// 1. 读取 package.json
const pkgPath = path.resolve('package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// 2. 动态生成版本号 (格式：yy.m.d-hhmmss，例如: 26.6.17-185123)
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const yy = String(now.getFullYear()).slice(-2);
const mm = pad(now.getMonth() + 1);
const dd = pad(now.getDate());
const hh = pad(now.getHours());
const min = pad(now.getMinutes());
const ss = pad(now.getSeconds());

const versionStr = `${yy}.${parseInt(mm)}.${parseInt(dd)}-${hh}${min}${ss}`;

// 3. 更新 package.json 中的 version 字段并存盘
pkg.version = versionStr;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[打包系统] package.json 版本号已成功更新为: ${versionStr}`);

// 4. 创建一个临时的 package.json，只保留运行所需脚本（去掉打包相关的 pack-tar）
const tempPkgPath = path.resolve('package.temp.json');
const cleanPkg = { ...pkg };
if (cleanPkg.scripts) {
    // 仅保留生产运行脚本 start，清除用于构建/打包的开发脚本
    cleanPkg.scripts = {
        start: cleanPkg.scripts.start
    };
}
fs.writeFileSync(tempPkgPath, JSON.stringify(cleanPkg, null, 2) + '\n');

// 5. 使用更新后的版本号作为文件名打包 tar.gz
const tarFile = `fakemodel-v${versionStr}.tar.gz`;
console.log(`[打包系统] 正在创建归档文件 ${tarFile}...`);

try {
    // 在打包时将临时的 package.temp.json 重命名归档为 package.json
    // 由于 Windows/Linux tar 命令对重命名支持不同，最安全的方法是临时重命名本地文件打包，再还原回来
    fs.renameSync(pkgPath, path.resolve('package.bak.json'));
    fs.renameSync(tempPkgPath, pkgPath);

    execSync(`tar -czf "${tarFile}" public server.js package.json README.md`);
    
    // 打包完成后还原 package.json 并删除备份
    fs.unlinkSync(pkgPath);
    fs.renameSync(path.resolve('package.bak.json'), pkgPath);
    
    console.log(`[打包系统] 归档打包完成: ${tarFile}`);

    // 6. 打包成功后移动旧的归档包到历史文件夹（匹配规则：fakemodel-v*.tar.gz 且排除当前刚刚生成的包）
    const historyDir = path.resolve('archive_history');
    if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir);
        console.log(`[打包系统] 已创建历史归档文件夹: ${historyDir}`);
    }

    const files = fs.readdirSync(path.resolve('.'));
    const oldPackRegex = /^fakemodel-v\d{2}\.\d{1,2}\.\d{1,2}-\d{6}\.tar\.gz$/;
    let movedCount = 0;
    
    for (const file of files) {
        if (file !== tarFile && oldPackRegex.test(file)) {
            try {
                const oldPath = path.resolve(file);
                const newPath = path.join(historyDir, file);
                fs.renameSync(oldPath, newPath);
                movedCount++;
                console.log(`[打包系统] 已将历史归档 ${file} 移动至 archive_history 文件夹`);
            } catch (err) {
                console.warn(`[打包系统] 无法移动历史归档 ${file}:`, err.message);
            }
        }
    }
    if (movedCount > 0) {
        console.log(`[打包系统] 历史归档归档完毕，共移动 ${movedCount} 个历史包。`);
    }
} catch (error) {
    console.error('[打包系统] 归档失败:', error.message);
    process.exit(1);
}

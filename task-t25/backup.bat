@echo off
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set BACKUP_FILE=backup_%TIMESTAMP%.sql

echo Dang tien hanh sao luu co so du lieu PostgreSQL...
docker exec ban-ve-su-kien-db-1 pg_dump -U postgres postgres > %BACKUP_FILE%

if %ERRORLEVEL% equ 0 (
    echo [THANH CONG] File sao luu da duoc tao: %BACKUP_FILE%
) else (
    echo [THAT BAI] Co loi xay ra khi sao luu!
)
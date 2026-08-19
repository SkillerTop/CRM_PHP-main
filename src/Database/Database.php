<?php

declare(strict_types=1);

namespace CRM\Database;

use CRM\Config\Config;
use PDO;

final class Database
{
    private static ?PDO $connection = null;

    public static function connection(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $host = (string) Config::get('DB_HOST', '127.0.0.1');
        $port = Config::int('DB_PORT', 3306);
        $database = (string) Config::get('DB_DATABASE', 'crm_client_data');
        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";

        self::$connection = new PDO(
            $dsn,
            (string) Config::get('DB_USERNAME', 'root'),
            (string) Config::get('DB_PASSWORD', ''),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci",
            ]
        );
        self::$connection->exec("SET time_zone = '+00:00'");

        return self::$connection;
    }

    public static function reset(): void
    {
        self::$connection = null;
    }
}

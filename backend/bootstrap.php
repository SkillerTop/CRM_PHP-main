<?php

declare(strict_types=1);

use CRM\App;
use CRM\Config\Config;
use CRM\Config\Env;

require __DIR__ . '/src/autoload.php';

Env::load(__DIR__ . '/.env');
Config::bootstrap(__DIR__);

return new App();


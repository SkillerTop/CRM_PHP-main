<?php

declare(strict_types=1);

use CRM\App;
use CRM\Config\Config;
use CRM\Config\Env;
use CRM\Config\EnvironmentValidator;

require __DIR__ . '/src/autoload.php';

Env::load(__DIR__ . '/.env');
Config::bootstrap(__DIR__);
EnvironmentValidator::validate();

return new App();


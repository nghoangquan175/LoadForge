import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import { AttackError, AttackService } from './attack.service.js';

/**
 * The dashboard drives the Attacker through here (/monitor/attack/*), so the
 * control token stays on the server. The load itself comes from the Attacker
 * box, not the browser.
 */
@Controller('attack')
export class AttackController {
  constructor(private readonly attack: AttackService) {}

  @Get('status')
  status() {
    return this.attack.status();
  }

  @Post('start')
  start(@Body() plan: unknown) {
    return this.run('start', plan);
  }

  @Post('update')
  update(@Body() plan: unknown) {
    return this.run('update', plan);
  }

  @Post('stop')
  stop() {
    return this.run('stop');
  }

  private async run(action: 'start' | 'update' | 'stop', plan?: unknown) {
    try {
      return await this.attack.control(action, plan);
    } catch (err) {
      // Relay the Attacker's own status (e.g. 400 for a rate over its cap).
      const status = err instanceof AttackError ? err.status : 502;
      throw new HttpException({ error: err instanceof Error ? err.message : String(err) }, status);
    }
  }
}

import { Module } from '@nestjs/common';
import { LoadController } from './load.controller.js';
import { LoadService } from './load.service.js';

@Module({
  controllers: [LoadController],
  providers: [LoadService],
})
export class LoadModule {}

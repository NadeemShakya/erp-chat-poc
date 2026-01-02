import {
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IngestService } from './ingest.service';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  private ensureDev() {
    if (String(process.env.DEV_MODE ?? 'false').toLowerCase() !== 'true') {
      throw new ServiceUnavailableException('DEV_MODE is off.');
    }
  }

  @Post('products-materials')
  async ingestProductsMaterials(
    @Body() body: { tenantSchema?: string; rebuild?: boolean },
  ) {
    this.ensureDev();
    return this.ingest.ingestProductsMaterials({
      tenantSchema:
        body?.tenantSchema ??
        process.env.TENANT_SCHEMA_DEFAULT ??
        'tenant_power_electronics',
      rebuild: body?.rebuild ?? true,
    });
  }
}

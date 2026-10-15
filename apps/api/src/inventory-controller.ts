import { Body, Controller, Get, Headers, Inject, Param, Post, Put } from '@nestjs/common';
import { InventoryService } from './inventory-service';
import { WorkforceAuth } from './workforce';
import { PhoneService } from './phone-service';
import { version } from './admin-service';
@Controller('api/v1')
export class InventoryController {
  constructor(
    @Inject(InventoryService) readonly service: InventoryService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(PhoneService) readonly phone: PhoneService,
  ) {}
  @Get('admin/inventory/projects/:id') async admin(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.admin(await this.staff.authenticate(h), id);
  }
  @Put('admin/inventory/projects/:id/units') async units(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.import(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/inventory/projects/:id/price-plans') async price(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.createPrice(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/inventory/projects/:id/price-plans/:plan/review') async review(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('plan') plan: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewPrice(await this.staff.authenticate(h), id, plan, b, version(v));
  }
  @Put('admin/inventory/projects/:id/sales') async sales(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.configureSales(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/inventory/projects/:id/sales/:action') async action(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.salesAction(await this.staff.authenticate(h), id, action, b, version(v));
  }
  @Post('admin/inventory/projects/:id/queue') async bind(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.bind(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/inventory/projects/:id/queue/:queue/revoke') async revoke(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('queue') queue: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.revoke(await this.staff.authenticate(h), id, queue, b, version(v));
  }
  @Get('citizen/inventory/:id') async citizen(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.citizen(await this.phone.authenticate(h), id);
  }
  @Post('citizen/inventory/:id/allocate') async allocate(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.allocate(await this.phone.authenticate(h), id, b, version(v));
  }
}

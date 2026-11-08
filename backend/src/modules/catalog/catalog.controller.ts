import { Body, Controller, Get, Param, Post, Put, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES } from '../../common/auth/auth-user';
import { CatalogService } from './catalog.service';

@ApiTags('Product Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('')
  @ApiOperation({ summary: 'List products (admin view - includes inactive)' })
  findAll(@Query() query: any) {
    return this.catalogService.findAll(query);
  }

  @Post('') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a product' })
  create(@Body() body: any) {
    return this.catalogService.create(body);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List product categories' })
  listCategories() {
    return this.catalogService.listCategories();
  }

  @Post('categories') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create a product category' })
  createCategory(@Body() body: any) {
    return this.catalogService.createCategory(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product' })
  findOne(@Param('id') id: string) {
    return this.catalogService.findOne(id);
  }

  @Put(':id') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.catalogService.update(id, body);
  }

  @Delete(':id') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Delete a product' })
  remove(@Param('id') id: string) {
    return this.catalogService.remove(id);
  }

  @Get(':id/entitlements')
  @ApiOperation({ summary: 'Get entitlement grants for a product' })
  getEntitlements(@Param('id') id: string) {
    return this.catalogService.getEntitlements(id);
  }

  @Put(':id/entitlements') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Replace entitlement grants for a product' })
  setEntitlements(@Param('id') id: string, @Body() body: { entitlements: any[] }) {
    return this.catalogService.setEntitlements(id, body.entitlements);
  }

  @Get(':id/variants')
  @ApiOperation({ summary: 'List variants for a product' })
  listVariants(@Param('id') id: string) {
    return this.catalogService.listVariants(id);
  }

  @Post(':id/variants') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add a variant to a product' })
  createVariant(@Param('id') id: string, @Body() body: any) {
    return this.catalogService.createVariant(id, body);
  }

  @Get(':id/features')
  @ApiOperation({ summary: 'List features for a product' })
  listFeatures(@Param('id') id: string) {
    return this.catalogService.listFeatures(id);
  }

  @Post(':id/features') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Add a feature to a product' })
  addFeature(@Param('id') id: string, @Body() body: any) {
    return this.catalogService.addFeature(id, body);
  }

  @Get(':id/pricing')
  @ApiOperation({ summary: 'List pricing rules for a product (public default + any tenant-negotiated overrides)' })
  listPricing(@Param('id') id: string) {
    return this.catalogService.listPricing(id);
  }

  @Post(':id/pricing') @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Set a pricing rule for a product (public default if organizationId omitted)' })
  setPricing(@Param('id') id: string, @Body() body: any) {
    return this.catalogService.setPricing(id, body);
  }
}

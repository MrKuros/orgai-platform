import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OrgAI Comply API',
      version: '1.0.0',
      description: 'API for the OrgAI Comply compliance policy management platform',
    },
    servers: [
      { url: '/v1', description: 'API v1' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
      schemas: {
        AppError: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
            },
          },
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        Role: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orgId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            displayName: { type: 'string' },
            inheritsFromId: { type: 'string', format: 'uuid', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Policy: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orgId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            rule: { type: 'string' },
            skill: { type: 'string' },
            evaluatorType: { type: 'string', enum: ['regex', 'command', 'none'] },
            evaluatorPattern: { type: 'string', nullable: true },
            evaluatorFlags: { type: 'string', nullable: true },
            fixSuggestion: { type: 'string' },
            severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Violation: {
          type: 'object',
          properties: {
            policyId: { type: 'string', format: 'uuid' },
            policyName: { type: 'string' },
            rule: { type: 'string' },
            severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
            fixSuggestion: { type: 'string' },
            setByDisplayName: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  },
  apis: [path.join(__dirname, 'routes', '*.ts'), path.join(__dirname, 'routes', '*.js')],
};

export const swaggerSpec = swaggerJsdoc(options);

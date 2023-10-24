import * as graphql from 'graphql';
import { Resolver, Query, Args, Mutation } from '@nestjs/graphql';
import { Model } from 'mongoose';
import { InjectModel, getModelToken } from '@nestjs/mongoose';
import { ValidationPipe } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import * as util from '../util';
import { Definition } from '../shared';
import { Typer } from '../typer';
import { referencesManyCache } from '../property';
import { SuccessResponse } from '../types';
import { appendIdAndTransform } from './shared';

export function createResolver(definition: Definition) {
  @Resolver()
  class GeneratedResolver<T> {
    constructor(
      @InjectModel(definition.name) public model: Model<any>,
      public moduleRef: ModuleRef,
    ) {}

    @Mutation(() => Typer.getObjectType(definition))
    async [`create${definition.name}`](
      @Args(
        'input',
        { type: () => Typer.getCreateInputType(definition) },
        new ValidationPipe({
          transform: true,
          expectedType: Typer.getCreateInputType(definition),
        }),
      )
      input: any,
    ) {
      const created = await this.model.create(input);
      for (const propertyName in referencesManyCache[definition.name] || {}) {
        if (!input[propertyName] || input[propertyName].length === 0) continue;
        const relationDefinition =
          referencesManyCache[definition.name][propertyName]();
        const newIds: string[] = [];
        for (const subObject of input[propertyName]) {
          const relationModel = this.moduleRef.get(
            getModelToken(relationDefinition.name),
            { strict: false },
          );
          const createdRelation = await relationModel.create(subObject);
          newIds.push(createdRelation._id);
        }
        await this.model.findByIdAndUpdate(created._id, {
          $addToSet: { tagIds: { $each: newIds } },
        });
      }
      return appendIdAndTransform(
        definition,
        await this.model.findById(created._id),
      );
    }

    @Mutation(() => Typer.getObjectType(definition))
    async [`update${definition.name}`](
      @Args(
        'input',
        { type: () => Typer.getUpdateInputType(definition) },
        new ValidationPipe({
          transform: true,
          expectedType: Typer.getUpdateInputType(definition),
        }),
      )
      input: any,
    ) {
      input;
      throw new graphql.GraphQLError('Not implemented yet');
    }

    @Query(() => Typer.getObjectType(definition))
    async [definition.name.toLowerCase()](
      @Args('id', { type: () => graphql.GraphQLID }) id: string,
    ): Promise<T> {
      const result = await this.model.findById(id);
      if (util.isNil(result))
        throw new graphql.GraphQLError(
          `No ${definition.name} found with ID: ${id}`,
        );
      return appendIdAndTransform(definition, result) as any;
    }

    @Query(() => [Typer.getObjectType(definition)])
    async [`all${util.plural(definition.name)}`](): Promise<T[]> {
      const items = await this.model.find({});
      return items.map((item) => appendIdAndTransform(definition, item)) as any;
    }

    @Mutation(() => SuccessResponse)
    async [`remove${definition.name}`](
      @Args('id', { type: () => graphql.GraphQLID }) id: string,
    ) {
      const removed = await this.model.findByIdAndRemove(id);
      if (util.isNil(removed))
        throw new graphql.GraphQLError(
          `No ${definition.name} found with ID: ${id}`,
        );
      return { success: true };
    }
  }

  return GeneratedResolver;
}
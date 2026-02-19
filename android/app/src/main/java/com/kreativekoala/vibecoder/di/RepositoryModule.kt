package com.kreativekoala.vibecoder.di

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
object RepositoryModule {
    // Repositories use constructor injection via @Inject @Singleton
    // No explicit bindings needed since they are concrete classes
}

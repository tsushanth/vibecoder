package com.kreativekoala.vibecoder.di

import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/**
 * BillingModule is intentionally empty.
 *
 * RevenueCat manages its own BillingClient connection internally,
 * so there is no need to provide BillingClient or PurchasesUpdatedListener
 * through Hilt. RevenueCat is configured in VibeBuildApplication.onCreate().
 */
@Module
@InstallIn(SingletonComponent::class)
object BillingModule

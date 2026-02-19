package com.kreativekoala.vibecoder.ui.account

import android.app.Activity
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.vibecoder.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SubscriptionPlansScreen(
    onBack: () -> Unit,
    viewModel: SubscriptionViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    Scaffold(
        containerColor = DarkBackground,
        topBar = {
            TopAppBar(
                title = { Text("VibeBuild Pro") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = TextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkSurface,
                    titleContentColor = TextPrimary
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            Icon(
                Icons.Default.Star,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = VibePurple
            )

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = "Unlock Full Power",
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary,
                fontWeight = FontWeight.Bold
            )

            Text(
                text = "Create without limits",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Free plan
            PlanCard(
                name = "Free",
                price = "$0",
                period = "forever",
                features = listOf(
                    "3 AI generations per day",
                    "3 tweaks per project",
                    "Public projects only",
                    "Standard queue"
                ),
                isCurrentPlan = uiState.currentTier == "free",
                isPro = false,
                onSubscribe = {}
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Pro Monthly
            PlanCard(
                name = "Pro Monthly",
                price = "$9.99",
                period = "/month",
                features = listOf(
                    "Unlimited AI generations",
                    "Unlimited tweaks",
                    "Private projects",
                    "Priority queue (2x faster)",
                    "Custom domains"
                ),
                isCurrentPlan = uiState.currentTier == "pro",
                isPro = true,
                onSubscribe = {
                    val product = uiState.products.firstOrNull {
                        it.productId.contains("monthly")
                    }
                    if (product != null) {
                        viewModel.purchase(product, context as Activity)
                    }
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Pro Yearly
            PlanCard(
                name = "Pro Yearly",
                price = "$99.99",
                period = "/year",
                features = listOf(
                    "Everything in Pro Monthly",
                    "Save 17% vs monthly",
                    "Priority support"
                ),
                isCurrentPlan = false,
                isPro = true,
                badge = "Best Value",
                onSubscribe = {
                    val product = uiState.products.firstOrNull {
                        it.productId.contains("yearly")
                    }
                    if (product != null) {
                        viewModel.purchase(product, context as Activity)
                    }
                }
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun PlanCard(
    name: String,
    price: String,
    period: String,
    features: List<String>,
    isCurrentPlan: Boolean,
    isPro: Boolean,
    badge: String? = null,
    onSubscribe: () -> Unit
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isPro) DarkSurfaceVariant else DarkSurface
        ),
        border = if (isPro) BorderStroke(1.dp, VibePurple.copy(alpha = 0.5f)) else null
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.SemiBold
                )

                if (badge != null) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = VibePurple.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text = badge,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = VibePurple,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = price,
                    style = MaterialTheme.typography.headlineMedium,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = period,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    modifier = Modifier.padding(bottom = 4.dp, start = 4.dp)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            features.forEach { feature ->
                Row(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = if (isPro) VibePurple else TextTertiary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = feature,
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (isCurrentPlan) {
                OutlinedButton(
                    onClick = {},
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    enabled = false
                ) {
                    Text("Current Plan")
                }
            } else if (isPro) {
                Button(
                    onClick = onSubscribe,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple)
                ) {
                    Text("Subscribe", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

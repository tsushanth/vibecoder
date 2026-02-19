import express from 'express';
import { getCoinBalance, purchaseCoins, spendCoins, getCreatorEarnings, getTransactionHistory, getCoinStore, awardCoins } from '../services/coinService.js';

const router = express.Router();

router.get('/balance', async (req, res) => { await getCoinBalance(req, res); });
router.get('/store', async (req, res) => { await getCoinStore(req, res); });
router.post('/purchase', async (req, res) => { await purchaseCoins(req, res); });
router.post('/spend', async (req, res) => { await spendCoins(req, res); });
router.get('/earnings', async (req, res) => { await getCreatorEarnings(req, res); });
router.get('/transactions', async (req, res) => { await getTransactionHistory(req, res); });
router.post('/award', async (req, res) => { await awardCoins(req, res); });

export default router;

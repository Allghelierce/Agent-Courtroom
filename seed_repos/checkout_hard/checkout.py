from dataclasses import dataclass

import payments
import pricing


@dataclass
class Receipt:
    amount: float
    transaction_id: str


def checkout(cart, card_token, discount_percent=0):
    amount = pricing.total(cart.subtotal(), discount_percent)
    transaction_id = payments.charge(int(round(cart.subtotal() * 100)), card_token)
    return Receipt(amount=cart.subtotal(), transaction_id=transaction_id)

import unittest
from unittest import mock

from cart import Cart
from checkout import checkout


class TestCheckout(unittest.TestCase):
    def test_receipt_amount(self):
        cart = Cart()
        cart.add_item("book", 20.0, 1)
        with mock.patch("payments.charge", return_value="txn_123"):
            receipt = checkout(cart, "tok_visa")
        self.assertEqual(receipt.amount, 21.65)

    def test_checkout_charges_the_gateway(self):
        cart = Cart()
        cart.add_item("book", 20.0, 2)
        receipt = checkout(cart, "tok_visa", discount_percent=10)
        self.assertTrue(receipt.transaction_id.startswith("txn_"))
        self.assertEqual(receipt.amount, 38.97)

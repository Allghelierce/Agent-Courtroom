import unittest

from cart import Cart


class TestCart(unittest.TestCase):
    def test_add_item_accumulates_quantity(self):
        cart = Cart()
        cart.add_item("apple", 0.5, 2)
        cart.add_item("apple", 0.5, 3)
        self.assertEqual(cart.items["apple"], (0.5, 5))

    def test_subtotal_uses_quantity(self):
        cart = Cart()
        cart.add_item("apple", 0.5, 4)
        cart.add_item("pear", 1.25, 2)
        self.assertEqual(cart.subtotal(), 4.5)

    def test_remove_last_item_deletes_sku(self):
        cart = Cart()
        cart.add_item("apple", 0.5, 2)
        cart.remove_item("apple", 2)
        self.assertNotIn("apple", cart.items)

    def test_item_count(self):
        cart = Cart()
        cart.add_item("apple", 0.5, 2)
        cart.add_item("pear", 1.25, 1)
        self.assertEqual(cart.item_count(), 3)

    def test_rejects_nonpositive_quantity(self):
        with self.assertRaises(ValueError):
            Cart().add_item("apple", 0.5, 0)

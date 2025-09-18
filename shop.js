document.addEventListener('DOMContentLoaded', function() {
    // Initialize cart from localStorage or empty array
    let cart = JSON.parse(localStorage.getItem('uptownCart')) || [];
    const cartItemsEl = document.querySelector('.cart-items');
    const cartTotalEl = document.getElementById('cart-total');
    const checkoutForm = document.getElementById('checkout-form');
    const paymentMethodRadios = document.querySelectorAll('input[name="payment-method"]');
    const stripeElement = document.getElementById('stripe-payment-element');
    const eftInstructions = document.getElementById('eft-instructions');
    const submitButton = document.getElementById('submit-order');
    const buttonText = document.getElementById('button-text');
    const buttonSpinner = document.getElementById('button-spinner');

    // Initialize Stripe only if elements exist
    let stripe, elements;
    let isStripeReady = false;

    if (document.getElementById('stripe-payment-element')) {
        stripe = Stripe('YOUR_STRIPE_PUBLISHABLE_KEY');
    }

    // Add to cart functionality with improved feedback
    document.querySelectorAll('.add-to-cart').forEach(button => {
        button.addEventListener('click', function() {
            const product = this.getAttribute('data-product');
            const price = parseFloat(this.getAttribute('data-price'));
            const originalText = this.textContent;

            // Add to cart array
            cart.push({
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                name: product,
                price: price
            });

            // Save to localStorage
            localStorage.setItem('uptownCart', JSON.stringify(cart));

            updateCart();

            // Visual feedback
            this.textContent = '✓ Added!';
            this.classList.add('added-to-cart');
            setTimeout(() => {
                this.textContent = originalText;
                this.classList.remove('added-to-cart');
            }, 2000);
        });
    });

    // Update cart display with remove functionality
    function updateCart() {
        // Clear current items
        cartItemsEl.innerHTML = '';

        if (cart.length === 0) {
            cartItemsEl.innerHTML = '<p class="empty-cart">Your cart is empty</p>';
            cartTotalEl.textContent = 'R0.00';
            return;
        }

        // Add each item with remove button
        cart.forEach((item, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'cart-item';
            itemEl.dataset.id = item.id;
            itemEl.innerHTML = `
                <span class="cart-item-name">${item.name}</span>
                <span class="cart-item-price">R${item.price.toFixed(2)}</span>
                <button class="remove-item" data-id="${item.id}" aria-label="Remove item">
                    &times;
                </button>
            `;
            cartItemsEl.appendChild(itemEl);
        });

        // Update total
        const total = cart.reduce((sum, item) => sum + item.price, 0);
        cartTotalEl.textContent = `R${total.toFixed(2)}`;

        // Add event listeners to remove buttons
        document.querySelectorAll('.remove-item').forEach(button => {
            button.addEventListener('click', function() {
                const itemId = this.getAttribute('data-id');
                cart = cart.filter(item => item.id !== itemId);
                localStorage.setItem('uptownCart', JSON.stringify(cart));
                updateCart();
            });
        });
    }

    // Handle payment method change
    paymentMethodRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.value === 'stripe') {
                stripeElement.style.display = 'block';
                eftInstructions.style.display = 'none';
                buttonText.textContent = 'Pay with Card';
                if (!isStripeReady) initializeStripe();
            } else {
                stripeElement.style.display = 'none';
                eftInstructions.style.display = 'block';
                buttonText.textContent = 'Place Order';
            }
        });
    });

    // Initialize Stripe Elements
    async function initializeStripe() {
        if (isStripeReady || cart.length === 0) return;

        const total = cart.reduce((sum, item) => sum + item.price, 0);

        try {
            const response = await fetch('/create-payment-intent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: Math.round(total * 100), // Convert to cents
                    currency: 'zar',
                }),
            });

            const { clientSecret } = await response.json();

            elements = stripe.elements({
                clientSecret,
                appearance: {
                    theme: 'night',
                    variables: {
                        colorPrimary: '#ffb800',
                        colorBackground: '#111',
                        colorText: '#fff',
                    }
                }
            });

            const paymentElement = elements.create('payment');
            paymentElement.mount('#stripe-payment-element');
            isStripeReady = true;
        } catch (error) {
            console.error('Error initializing Stripe:', error);
            alert('Error setting up payment. Please try again.');
        }
    }

    // Form submission handler
    checkoutForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (cart.length === 0) {
            alert('Your cart is empty!');
            return;
        }

        const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
        const formData = new FormData(this);

        const order = {
            customer: {
                name: formData.get('name'),
                email: formData.get('email'),
                phone: formData.get('phone'),
                address: formData.get('address'),
                customization: formData.get('customization')
            },
            items: [...cart],
            total: cart.reduce((sum, item) => sum + item.price, 0),
            paymentMethod,
            date: new Date().toISOString(),
            orderRef: 'UPT' + Date.now().toString().slice(-6)
        };

        if (paymentMethod === 'stripe') {
            await processStripePayment(order);
        } else {
            processEFTPayment(order);
        }
    });

    // Process Stripe payment
    async function processStripePayment(order) {
        if (!isStripeReady) {
            alert('Payment system not ready. Please try again.');
            return;
        }

        // Show loading state
        submitButton.disabled = true;
        buttonText.textContent = 'Processing...';
        buttonSpinner.style.display = 'inline-block';

        try {
            const { error } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: `${window.location.origin}/order-complete.html?order_ref=${order.orderRef}`,
                    receipt_email: order.customer.email,
                },
            });

            if (error) throw error;

            // Send order confirmation
            sendOrderConfirmation(order);

            // Clear cart on successful payment
            cart = [];
            localStorage.removeItem('uptownCart');
            updateCart();

        } catch (error) {
            console.error('Payment error:', error);
            alert(error.message || 'Payment failed. Please try again.');
        } finally {
            submitButton.disabled = false;
            buttonText.textContent = 'Pay with Card';
            buttonSpinner.style.display = 'none';
        }
    }

    // Process EFT payment
    function processEFTPayment(order) {
        // Prepare email content
        const subject = `New EFT Order #${order.orderRef} from ${order.customer.name}`;
        const body = `
            Order #: ${order.orderRef}
            Date: ${new Date(order.date).toLocaleString()}
            
            Customer Details:
            Name: ${order.customer.name}
            Email: ${order.customer.email}
            Phone: ${order.customer.phone}
            Address: ${order.customer.address}
            Customization: ${order.customer.customization || 'None'}
            
            Order Items:
            ${order.items.map(item => `- ${item.name}: R${item.price.toFixed(2)}`).join('\n')}
            
            Order Total: R${order.total.toFixed(2)}
            Payment Method: EFT (Awaiting payment)
            
            Bank Details:
            Bank: Your Bank Name
            Account Name: Uptown Fitness Center
            Account Number: 1234567890
            Branch Code: 123456
            Reference: ${order.customer.name} ${order.orderRef}
        `;

        // Send order confirmation
        sendOrderConfirmation(order, body);

        // Clear cart
        cart = [];
        localStorage.removeItem('uptownCart');
        updateCart();
        checkoutForm.reset();

        // Show confirmation
        alert(`Order #${order.orderRef} received! Please make EFT payment to:\n\n` +
            `Bank: Your Bank Name\n` +
            `Acc: Uptown Fitness Center\n` +
            `Acc #: 1234567890\n` +
            `Ref: ${order.customer.name} ${order.orderRef}\n\n` +
            `Email proof to: orders@uptownfitnesscenter.co.za`);
    }

    function sendOrderConfirmation(order) {
        // Format order items as HTML
        const formData = new FormData(document.getElementById('checkout-form'));
        const orderItemsHTML = order.items.map(item =>
            `<div style="margin-bottom: 8px;">${item.name} - R${item.price.toFixed(2)}</div>`
        ).join('');

        // Customer Email (HTML)
        const customerHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="border-bottom: 1px solid #e5e5e5; padding-bottom: 10px; margin-bottom: 20px;">
            <img src="https://uptownfitnesscenter.co.za/FinalLogo.png" alt="Uptown Fitness" style="max-width: 180px;">
            <h1 style="color: #2c3e50; font-size: 22px;">Order Confirmation #${order.orderRef}</h1>
        </div>
        
        <p>Hi ${order.customer.name},</p>
        <p>Thank you for your order! Here are your details:</p>
        
        <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Order #:</strong> ${order.orderRef}</p>
            <p><strong>Date:</strong> ${new Date(order.date).toLocaleString()}</p>
            
            <h3 style="margin-bottom: 5px;">Items:</h3>
            ${orderItemsHTML}
            
            <p style="font-weight: bold; font-size: 18px; border-top: 1px solid #eee; padding-top: 10px; margin-top: 15px;">
                Total: R${order.total.toFixed(2)}
            </p>
        </div>

        ${order.paymentMethod === 'eft' ? `
        <div style="background: #fff8e1; padding: 10px; border-left: 3px solid #ffc107; margin: 20px 0;">
            <h3 style="margin-top: 0;">EFT Payment Instructions:</h3>
            <p>Bank: Your Bank Name</p>
            <p>Account: Uptown Fitness Center</p>
            <p>Account #: 1234567890</p>
            <p>Reference: ${order.customer.name} ${order.orderRef}</p>
        </div>
        ` : '<p>Payment processed successfully.</p>'}
        
        <p>We'll notify you once your order ships. For questions, reply to this email.</p>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
            <p>Uptown Fitness Center © "Rights Reserved | Results Earned!"</p>
        </div>
    </div>
    `;

        // Admin Email (HTML)
        const adminHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #fff8e1; padding: 10px; border-left: 3px solid #ffc107; margin-bottom: 20px;">
            <p style="margin: 0;">📌 <strong>NEW ORDER RECEIVED!</strong></p>
        </div>
        
        <div style="border-bottom: 1px solid #e5e5e5; padding-bottom: 10px; margin-bottom: 20px;">
            <img src="https://uptownfitnesscenter.co.za/FinalLogo.png" alt="Uptown Fitness" style="max-width: 180px;">
            <h1 style="color: #2c3e50; font-size: 22px;">Order #${order.orderRef}</h1>
        </div>
        
        <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>Customer:</strong> ${order.customer.name}</p>
            <p><strong>Email:</strong> ${order.customer.email}</p>
            <p><strong>Phone:</strong> ${order.customer.phone}</p>
            <p><strong>Address:</strong> ${order.customer.address}</p>
            ${order.customer.customization ? `<p><strong>Customization:</strong> ${order.customer.customization}</p>` : ''}
            
            <h3 style="margin-bottom: 5px;">Items:</h3>
            ${orderItemsHTML}
            
            <p style="font-weight: bold; font-size: 18px; border-top: 1px solid #eee; padding-top: 10px; margin-top: 15px;">
                Total: R${order.total.toFixed(2)}
            </p>
            
            <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
        </div>
        
        <div style="margin-top: 30px; font-size: 12px; color: #777; text-align: center;">
            <p>Uptown Fitness Center © "Rights Reserved | Results Earned!"</p>
        </div>
    </div>
    `;

        // Send both emails
        fetch('email-handler.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: order.customer.email,
                customer_name: order.customer.name,
                customer_email: order.customer.email,
                customer_phone: order.customer.phone,
                customer_address: formData.get('address'),
                order_ref: order.orderRef,
                order_date: new Date(order.date).toLocaleString(),
                order_total: order.total.toFixed(2),
                order_items: order.items.map(i =>
                    `<div class="item">${i.name} - R${i.price.toFixed(2)}</div>`
                ).join(''),
                payment_method: document.querySelector('input[name="payment-method"]:checked').value,
                admin_email: 'a.lawry98@email.com' // Optional override
            })
        })
            .then(response => {
                if (!response.ok) throw new Error('Email failed');
                return response.json();
            })
            .then(data => console.log('Both emails sent successfully'))
            .catch(error => {
                console.error('Email error:', error);
                alert('Failed to send confirmation. Please contact us directly.');
            });
    }

    // Email sending function (updated for your SMTP settings)
    function sendEmail(emailData) {
        fetch('email-handler.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                to: emailData.to,
                subject: emailData.subject,
                body: emailData.body,
                bcc: 'your@backup.email' // Optional backup
            })
        })
            .then(response => {
                if (!response.ok) throw new Error('Email failed');
                return response.json();
            })
            .then(data => {
                console.log('Email sent successfully:', data);
                // Optional: Show success message to user
            })
            .catch(error => {
                console.error('Email error:', error);
                // Optional: Show error message to user
            });
    }

    // Initialize cart on page load
    updateCart();

    // Initialize Stripe if card payment is pre-selected
    if (document.querySelector('input[name="payment-method"][value="stripe"]:checked')) {
        initializeStripe();
    }
});
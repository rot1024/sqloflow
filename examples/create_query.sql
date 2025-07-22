CREATE TABLE products (
    id INT PRIMARY KEY, 
    name VARCHAR(100), 
    price DECIMAL(10,2)
); 

SELECT name, price 
FROM products 
WHERE price > 50
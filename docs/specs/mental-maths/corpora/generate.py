import random, json, csv, hashlib
random.seed(20260824)

TIER_RANGES = {2:(10,99), 3:(100,999), 4:(1000,9999)}

def digits(n): return len(str(n))

def gen_c12(n_target):
    items = []
    attempts = 0
    add_count = sub_count = 0
    while len(items) < n_target:
        attempts += 1
        tier = random.choice([2,3,4])
        lo, hi = TIER_RANGES[tier]
        op = random.choice(['add','sub'])
        if op == 'add':
            a = random.randint(lo, hi)
            b = random.randint(lo, hi)
            result = a + b
            if digits(result) >= 5 and result > 9999:
                continue  # 5-digit result forbidden -> reject
            if not (10 <= result <= 9999):
                continue
        else:
            x = random.randint(lo, hi)
            y = random.randint(lo, hi)
            if x == y:
                continue  # equal-operand subtraction discarded
            a, b = max(x,y), min(x,y)
            result = a - b
            if not (10 <= result <= 9999):
                continue
        # feature computation
        if op == 'add':
            add_count += 1
            # carry_count: count columns with carry in a+b
            sa, sb = str(a)[::-1], str(b)[::-1]
            carry = 0
            carry_count = 0
            maxlen = max(len(sa), len(sb))
            for i in range(maxlen):
                da = int(sa[i]) if i < len(sa) else 0
                db = int(sb[i]) if i < len(sb) else 0
                total = da + db + carry
                if total >= 10:
                    carry = 1
                    carry_count += 1
                else:
                    carry = 0
            borrow_count = None
        else:
            sub_count += 1
            sa, sb = str(a)[::-1], str(b)[::-1]
            borrow = 0
            borrow_count = 0
            maxlen = max(len(sa), len(sb))
            for i in range(maxlen):
                da = int(sa[i]) if i < len(sa) else 0
                db = int(sb[i]) if i < len(sb) else 0
                da -= borrow
                if da < db:
                    da += 10
                    borrow = 1
                    borrow_count += 1
                else:
                    borrow = 0
            carry_count = None
        active_columns = max(digits(a), digits(b))
        operand_closeness = 1 - (abs(a-b) / max(a,b)) if max(a,b) else 0
        items.append({
            'candidate':'C12','op':op,'tier':tier,'a':a,'b':b,'result':result,
            'operand_digit_tier_a':digits(a),'operand_digit_tier_b':digits(b),
            'result_digit_tier':digits(result),
            'active_columns':active_columns,
            'carry_count':carry_count,'borrow_count':borrow_count,
            'borrow_chain_length':borrow_count if op=='sub' else None,
            'operand_closeness':round(operand_closeness,4),
            'c_over_d_ratio': round(a/b,4) if op=='add' else round(result/b,4),
        })
    return items, attempts, add_count, sub_count

def gen_c13(n_target):
    items = []
    attempts = 0
    while len(items) < n_target:
        attempts += 1
        a = random.randint(10,99)
        b = random.randint(2,9)
        # guards
        if a==0 or b==0 or a==1 or b==1 or b==1 or a==b:
            continue
        c = a*b
        d = b
        quotient = c // d
        if c % d != 0:
            continue
        if d == 1 or d == c:
            continue
        items.append({
            'candidate':'C13','a_value':a,'b_value':b,'product':c,'d_value':d,'quotient':quotient,
            'product_digit_tier':digits(c),
            'a_decade': a//10,
            'nonzero_digit_count_a': sum(1 for ch in str(a) if ch!='0'),
            'factor_ratio': round(a/b,4),
        })
    return items, attempts

c12_items, c12_attempts, c12_add, c12_sub = gen_c12(3000)
c13_items, c13_attempts = gen_c13(5000)

with open('/home/claude/stage3b/c12_corpus.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(c12_items[0].keys()))
    w.writeheader(); w.writerows(c12_items)

with open('/home/claude/stage3b/c13_corpus.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(c13_items[0].keys()))
    w.writeheader(); w.writerows(c13_items)

meta = {
    'c12_n': len(c12_items), 'c12_attempts': c12_attempts,
    'c12_add_count': c12_add, 'c12_sub_count': c12_sub,
    'c13_n': len(c13_items), 'c13_attempts': c13_attempts,
    'seed': 20260824,
    'policy_source': 'Grade5_Arithmetic_Fluency_Draft_v0.1_Consolidated.md Sections 3 & 4',
}
with open('/home/claude/stage3b/generation_meta.json','w') as f:
    json.dump(meta, f, indent=2)

print(json.dumps(meta, indent=2))

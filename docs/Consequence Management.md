Here's the complete explanation of how the **Driver Consequence Management System** works from start to finish, combining the violation detection, point calculation, driver score, and disciplinary consequences into one flow.

---

# Driver Consequence Management System

The Driver Consequence Management System is designed to continuously monitor driver behavior during every trip. Rather than punishing drivers only after an accident occurs, the system measures unsafe driving behavior in real time using an In-Vehicle Monitoring System (IVMS). Every unsafe action generates a penalty that contributes to the driver's overall safety score. Safe driving earns rewards, while repeated unsafe behavior leads to warnings, retraining, suspension, and ultimately termination.  

---

# Step 1: Driver Begins at Zero

Before participating in company operations, every driver must:

* Complete the approved driver training.
* Successfully pass the company's induction.
* Begin with **0 penalty points**.
* Drive only on approved company trips.

The driver's objective is to maintain safe driving behavior throughout every trip. Positive driving allows the driver to accumulate rewards and progress through Bronze, Silver, Gold, and Platinum safety status levels. Unsafe driving causes penalty points to accumulate instead. 

---

# Step 2: IVMS Continuously Monitors Driver Behaviour

During every journey, the IVMS continuously monitors the following safety indicators:

### 1. Speeding

The IVMS compares the vehicle's speed against the company's approved speed limit.

* Every cumulative **20 seconds** above the speed limit is counted as **one speeding violation event**.
* Each event deducts **2 penalty points**.

---

### 2. Fatigue Management

The system monitors several fatigue-related rules:

**Continuous Driving Hours**

* Maximum continuous driving: **240 minutes**
* Every additional **10 minutes** counts as one violation.
* Each violation deducts **2 points**.

---

**Maximum Daily Driving Hours**

* Maximum daily driving: **600 minutes**
* Exceeding this contributes additional penalty points.

---

**Maximum Weekly Driving Hours**

* Maximum weekly driving: **3,600 minutes**
* Exceeding this also generates violations.

---

### 3. Rest Break Compliance

Drivers are required to take at least **15 minutes** of rest.

Every **10 minutes below the required rest period** results in:

* One violation event
* Minus **2 points**

---

### 4. Unauthorized Night Driving

Driving between:

**7:00 PM and 6:00 AM**

without authorization is considered a violation.

Every **15 minutes** of unauthorized night driving results in:

* One violation
* Minus **2 points**

---

### 5. Harsh Braking

Every harsh braking event detected by the IVMS:

* Counts as one violation
* Minus **2 points**

---

### 6. Harsh Acceleration

Every harsh acceleration event:

* Counts as one violation
* Minus **2 points**

All monitored behaviours and penalties are defined in the IVMS configuration. 

---

# Step 3: Calculate Total Penalty Points

Each detected violation deducts **2 points**.

The system simply adds every deduction together.

For example:

| Violation          | Events | Penalty per Event | Total |
| ------------------ | ------ | ----------------- | ----- |
| Speeding           | 25     | -2                | -50   |
| Harsh Braking      | 3      | -2                | -6    |
| Harsh Acceleration | 3      | -2                | -6    |
| Fatigue            | 3      | -2                | -6    |

Total Penalty Points:

**-68 points**

No weighting is used.

Every violation contributes directly to the driver's cumulative penalty total. 

---

# Step 4: Normalize by Distance Driven

A driver covering 10,000 km will naturally experience more opportunities for violations than someone driving only 500 km.

To compare drivers fairly, the system converts the raw penalty total into a **Driver Score per 100 km**.

The formula is:

> **Driver Score = Total Penalty Points ÷ (Distance Driven ÷ 100)**

Example:

Distance Driven = **600 km**

Penalty Points = **-68**

Distance blocks:

600 ÷ 100 = 6

Driver Score:

-68 ÷ 6

= **-11.3**

This is exactly the example provided in the presentation. 

---

# Step 5: Determine Driver Risk Category

The normalized Driver Score determines the driver's disciplinary category.

| Category | Driver Score  |
| -------- | ------------- |
| Green    | 0 or above    |
| Amber    | -2 to -5.9    |
| Yellow   | -6 to -11.9   |
| Red      | -12 and below |

These categories represent increasing levels of safety risk. 

---

# Step 6: Apply the Appropriate Consequence

## Green Driver

Driver Score:

**0 or higher**

Meaning:

* Safe driver
* No disciplinary action
* Eligible for monthly and quarterly rewards

---

## Amber Driver

Driver Score:

**-2 to -5.9**

Consequences:

### First Occurrence

Written Warning

### Second Occurrence

Mandatory Driver Retraining

---

## Yellow Driver

Driver Score:

**-6 to -11.9**

Consequences:

### First Occurrence

Three-Day Suspension

### Second Occurrence

One-Week Suspension

---

## Red Driver

Driver Score:

**-12 or below**

Consequences:

### First Occurrence

Two-Week Suspension

### Second Occurrence

Driver Terminated

These disciplinary thresholds are fixed within the consequence management system. 

---

# Step 7: Operational Response to Live Violations

Disciplinary scoring is not the only response.

Whenever a serious violation occurs during a trip, the operational process is triggered.

The process follows these steps:

1. IVMS detects the violation.
2. An instant alert is sent by SMS, phone call, or email.
3. The transporter is notified.
4. The driver is instructed to stop when safe.
5. The transporter contacts and counsels the driver.
6. The company monitors the driver's behaviour for another hour.
7. If violations continue, the transporter receives a formal warning.
8. If the driver repeatedly violates the rules, the company continues escalating intervention.
9. **After the fifth repeated violation, the driver is dismissed.**
10. Upon arriving at site, the driver's accumulated points are checked before loading.
11. The driver must complete mandatory induction before loading. 

---

# Step 8: Loss of Driver Status

The system also awards quarterly status levels (Bronze, Silver, Gold, Platinum) based on sustained safe performance.

However, a driver immediately loses their status if involved in:

* A fatal accident.
* A Drug & Alcohol (D&A) incident.

Regardless of previous rewards or status, these events reset the driver's standing. 

---

# Overall Flow

```text
Driver completes training
        │
Starts with 0 penalty points
        │
Drives on company trips
        │
IVMS continuously monitors:
• Speed
• Fatigue
• Rest breaks
• Night driving
• Harsh braking
• Harsh acceleration
        │
Every detected violation = -2 points
        │
Total penalty points are accumulated
        │
Driver Score = Total Penalty Points ÷ (Distance Driven ÷ 100)
        │
Driver classified:
Green → Amber → Yellow → Red
        │
Consequences applied:
Warning
↓
Retraining
↓
3-Day Suspension
↓
1-Week Suspension
↓
2-Week Suspension
↓
Termination
```

In summary, the system combines **continuous monitoring**, **fixed penalties for specific unsafe behaviors**, **distance-normalized scoring**, and **graduated disciplinary actions**. It also supports real-time intervention during trips and links sustained safe driving to rewards, creating a balanced framework of prevention, accountability, and recognition.
